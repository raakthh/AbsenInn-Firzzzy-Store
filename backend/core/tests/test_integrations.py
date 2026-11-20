"""Supabase integrations that can't run offline: asymmetric JWT (JWKS),
Storage REST calls and the Auth admin invite — verified with mocks."""
import time
from unittest import mock

import jwt
from cryptography.hazmat.primitives.asymmetric import ec
from django.test import override_settings
from rest_framework.test import APIClient

from core import auth as core_auth
from core import storage, supabase_admin
from core.exceptions import ApiError
from core.testing import ApiTestCase


class JwksTests(ApiTestCase):
    def setUp(self):
        self.key = ec.generate_private_key(ec.SECP256R1())
        core_auth._jwks_client.cache_clear()

    def es256(self, sub, key=None, aud="authenticated"):
        now = int(time.time())
        return jwt.encode({"sub": str(sub), "aud": aud, "role": "authenticated", "iat": now, "exp": now + 600},
                          key or self.key, algorithm="ES256", headers={"kid": "k1"})

    def call(self, token):
        c = APIClient(); c.credentials(HTTP_AUTHORIZATION=f"Bearer {token}")
        return c.get("/api/auth/me/")

    @override_settings(SUPABASE_URL="https://proj.supabase.co")
    def test_es256_token_verified_with_jwks(self):
        signing = mock.Mock(key=self.key.public_key())
        client = mock.Mock(get_signing_key_from_jwt=mock.Mock(return_value=signing))
        with mock.patch("core.auth._jwks_client", return_value=client):
            self.assertStatus(self.call(self.es256(self.owner_profile.id)), 200)
            other = ec.generate_private_key(ec.SECP256R1())                     # forged with a different key
            self.assertStatus(self.call(self.es256(self.owner_profile.id, key=other)), 401)
            self.assertStatus(self.call(self.es256(self.owner_profile.id, aud="x")), 401)

    def test_jwks_url(self):
        with override_settings(SUPABASE_URL="https://proj.supabase.co"), mock.patch("jwt.PyJWKClient") as cls:
            core_auth._jwks_client()
        cls.assert_called_once()
        self.assertEqual(cls.call_args.args[0], "https://proj.supabase.co/auth/v1/.well-known/jwks.json")


@override_settings(SUPABASE_URL="https://proj.supabase.co", SUPABASE_SERVICE_ROLE_KEY="service-key", STORAGE_BACKEND="supabase")
class SupabaseHttpTests(ApiTestCase):
    def test_storage_upload_and_sign(self):
        with mock.patch("core.storage.requests.post") as post:
            post.return_value = mock.Mock(status_code=200, text="{}")
            storage.get_storage().upload("attendance-selfies", "c/e/x.jpg", b"\xff\xd8\xff", "image/jpeg")
            url, kw = post.call_args.args[0], post.call_args.kwargs
            self.assertEqual(url, "https://proj.supabase.co/storage/v1/object/attendance-selfies/c/e/x.jpg")
            self.assertEqual(kw["headers"]["Authorization"], "Bearer service-key"); self.assertEqual(kw["headers"]["x-upsert"], "true")
            post.return_value = mock.Mock(status_code=200, json=lambda: {"signedURL": "/object/sign/attendance-selfies/c/e/x.jpg?token=abc"})
            u = storage.get_storage().signed_url("attendance-selfies", "c/e/x.jpg")
            self.assertEqual(u, "https://proj.supabase.co/storage/v1/object/sign/attendance-selfies/c/e/x.jpg?token=abc")
            self.assertEqual(post.call_args.kwargs["json"], {"expiresIn": 300})
            post.return_value = mock.Mock(status_code=500, text="boom")
            with self.assertRaises(ApiError) as e:
                storage.get_storage().upload("attendance-selfies", "c/e/y.jpg", b"x", "image/jpeg")
            self.assertEqual(e.exception.code, "UPLOAD_FAILED")

    def test_invite(self):
        with mock.patch("core.supabase_admin.requests.post") as post:
            post.return_value = mock.Mock(status_code=200, json=lambda: {"id": "11111111-1111-4111-8111-111111111111"})
            uid = supabase_admin.invite_user("dina@firzzzystore.com", "Dina")
        self.assertEqual(uid, "11111111-1111-4111-8111-111111111111")
        self.assertEqual(post.call_args.args[0], "https://proj.supabase.co/auth/v1/invite")
        self.assertEqual(post.call_args.kwargs["json"]["email"], "dina@firzzzystore.com")

    def test_missing_service_key_is_clear_error(self):
        with override_settings(SUPABASE_SERVICE_ROLE_KEY=""):
            with self.assertRaises(ApiError) as e:
                storage.get_storage()
        self.assertEqual(e.exception.code, "STORAGE_NOT_CONFIGURED")


class LocalStorageSafetyTests(ApiTestCase):
    def test_path_traversal_blocked(self):
        with self.assertRaises(ApiError):
            storage.LocalStorage().upload("attendance-selfies", "../../etc/passwd", b"x", "text/plain")
