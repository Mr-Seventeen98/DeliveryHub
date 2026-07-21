# Security Policy

## Supported versions

Security fixes are applied to the latest version on the default branch. Older snapshots and offline release bundles are not maintained independently.

## Reporting a vulnerability

Do not report vulnerabilities, leaked credentials, internal URLs, or exploit details in a public Issue or Discussion.

Use GitHub's private vulnerability reporting flow from the repository's **Security** tab. If private reporting is unavailable, contact a repository maintainer through a private channel and include only the minimum information needed to establish contact.

Please include:

- the affected version or commit;
- reproduction steps and expected impact;
- whether credentials or production data may be exposed;
- any mitigation already applied.

Rotate or revoke any exposed credential immediately. Removing a credential from Git history does not make it safe to keep using.

## Deployment responsibility

Delivery Hub can access CI systems, registries, and deployment servers. Operators are responsible for network isolation, TLS termination, least-privilege service accounts, credential backup and rotation, and restricting administrative access.
