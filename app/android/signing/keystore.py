"""Makes the Android app's signing key (a PKCS#12 keystore) from a secret.

    APP_SIGNING_KEY=... python3 keystore.py <out.p12> <env file> [--require-stable]

The same secret always gives the same key and certificate, so every new
version of the app can be installed over the old one (Android only accepts an
update signed by the same certificate). The secret lives in the repository's
GitHub Actions secrets (APP_SIGNING_KEY); nothing secret is committed.

Without APP_SIGNING_KEY a random throw-away key is used (fine for test
builds); --require-stable refuses that. Appends the build's settings to the
env file (GitHub's $GITHUB_ENV): ANDROID_KEYSTORE, ANDROID_KEYSTORE_PASSWORD,
ANDROID_KEY_ALIAS, APP_CERT_SHA256, APP_SIGNING_STABLE.
"""
import datetime
import hashlib
import hmac
import os
import sys

from cryptography import x509
from cryptography.hazmat.primitives import hashes, serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.primitives.serialization import pkcs12
from cryptography.x509.oid import NameOID

DOMAIN = b'two-state-casino/android-signing/v1'
SMALL_PRIMES = [p for p in range(3, 2000) if all(p % d for d in range(2, int(p ** 0.5) + 1))]


class Stream:
    """Deterministic byte stream: HMAC-SHA256 in counter mode, keyed by the secret."""

    def __init__(self, secret):
        self.key = hmac.new(DOMAIN, secret, hashlib.sha256).digest()
        self.counter = 0

    def read(self, n):
        out = b''
        while len(out) < n:
            self.counter += 1
            out += hmac.new(self.key, self.counter.to_bytes(8, 'big'), hashlib.sha256).digest()
        return out[:n]

    def below(self, n):
        k = (n.bit_length() + 7) // 8 + 8
        return int.from_bytes(self.read(k), 'big') % n


def probably_prime(n, stream, rounds=48):
    for p in SMALL_PRIMES:
        if n % p == 0:
            return n == p
    d, r = n - 1, 0
    while d % 2 == 0:
        d //= 2
        r += 1
    for _ in range(rounds):
        x = pow(2 + stream.below(n - 3), d, n)
        if x in (1, n - 1):
            continue
        for _ in range(r - 1):
            x = pow(x, 2, n)
            if x == n - 1:
                break
        else:
            return False
    return True


def prime(stream, bits, e):
    while True:
        c = int.from_bytes(stream.read(bits // 8), 'big')
        c |= (3 << (bits - 2)) | 1          # full length product, odd
        if (c - 1) % e == 0:
            continue
        if probably_prime(c, stream):
            return c


def rsa_key(secret):
    stream = Stream(secret)
    e = 65537
    p = prime(stream, 1536, e)
    q = prime(stream, 1536, e)
    if p < q:
        p, q = q, p
    n = p * q
    d = pow(e, -1, (p - 1) * (q - 1) // _gcd(p - 1, q - 1))
    numbers = rsa.RSAPrivateNumbers(p, q, d, d % (p - 1), d % (q - 1), pow(q, -1, p), rsa.RSAPublicNumbers(e, n))
    return numbers.private_key()


def _gcd(a, b):
    while b:
        a, b = b, a % b
    return a


def certificate(key):
    name = x509.Name([x509.NameAttribute(NameOID.COMMON_NAME, 'Two state Casino'),
                      x509.NameAttribute(NameOID.ORGANIZATION_NAME, 'Two state Casino RP')])
    pub = key.public_key()
    serial = int.from_bytes(hashlib.sha256(pub.public_bytes(serialization.Encoding.DER,
                                                            serialization.PublicFormat.SubjectPublicKeyInfo)).digest()[:16], 'big') >> 1
    # every field fixed and RSA PKCS#1 v1.5 signatures are deterministic: the same certificate every time
    return (x509.CertificateBuilder()
            .subject_name(name).issuer_name(name).public_key(pub).serial_number(serial)
            .not_valid_before(datetime.datetime(2026, 1, 1, tzinfo=datetime.timezone.utc))
            .not_valid_after(datetime.datetime(2076, 1, 1, tzinfo=datetime.timezone.utc))
            .sign(key, hashes.SHA256()))


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    if len(args) != 2:
        sys.exit('usage: keystore.py <out.p12> <env file> [--require-stable]')
    secret = os.environ.get('APP_SIGNING_KEY', '').strip().encode('utf-8')
    stable = len(secret) >= 16
    if not stable and '--require-stable' in sys.argv:
        sys.exit('::error::APP_SIGNING_KEY (16 characters or more) is not set: see README.md')
    if not stable:
        secret = os.urandom(32)
    key = rsa_key(secret)
    cert = certificate(key)
    password = hmac.new(secret, b'keystore-password', hashlib.sha256).hexdigest()
    out, env = args
    with open(out, 'wb') as fh:
        fh.write(pkcs12.serialize_key_and_certificates(b'app', key, cert, None,
                                                       serialization.BestAvailableEncryption(password.encode())))
    print('::add-mask::' + password)
    fingerprint = hashlib.sha256(cert.public_bytes(serialization.Encoding.DER)).hexdigest()
    with open(env, 'a', encoding='utf-8') as fh:
        fh.write('ANDROID_KEYSTORE=%s\n' % os.path.abspath(out))
        fh.write('ANDROID_KEYSTORE_PASSWORD=%s\n' % password)
        fh.write('ANDROID_KEY_ALIAS=app\n')
        fh.write('APP_CERT_SHA256=%s\n' % fingerprint)
        fh.write('APP_SIGNING_STABLE=%s\n' % ('true' if stable else 'false'))
    print('signing certificate SHA-256: %s (%s)' % (fingerprint, 'stable' if stable else 'one-off test key'))


if __name__ == '__main__':
    main()
