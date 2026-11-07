# VocalFlow launch plan

## Release gates

1. One relocatable processing runtime: run Python tools with the bundled interpreter, never build-machine console scripts. Validate download and separation entry points after relocation.
2. Offline acceptance: empty user cache, blocked network, bundled default models, short local audio -> vocal/backing stems -> timed transcript. A file-existence check alone is insufficient.
3. Online acceptance: search -> Add -> media download -> processing, including retry after network failure. Keep default workflow free of tokens and dependency installation.
4. Publish an explicitly labeled beta until installed-app acceptance passes. Apple Developer ID signing/notarization requires the owner's credentials; never describe unsigned builds as signed.

## Website and delivery

- Static bilingual site in apps/website; Chinese first, Studio sage/ink palette, clear hardware requirements, installation instructions and known limitations.
- Dedicated hostname and HTTPS through existing Caddy. No new public application/admin port, login, upload endpoint, or remote processing API.
- Immutable versioned installers; download to staging, verify SHA-256 against the GitHub asset digest, then atomically publish. Reject mismatched or missing digests. No arbitrary proxy URLs.
- Explicit file routes, no directory listing, GET/HEAD only, read-only public files, security headers, Range support. Retain only a bounded number of releases and monitor disk/network usage.
- Benchmark actual external download speed before claiming acceleration; server bandwidth is not yet known. CDN/object storage can replace the origin without changing the client processing architecture.

## Later milestones

- Persistent stage checkpoints and resume, opt-in redacted diagnostic export, update notification (no unsigned automatic execution).
- Server coordinates optional compute workers only after memory, concurrency, authentication, quotas and data-retention controls are validated. Existing 4-vCPU/4-GB shared host is not the production inference backend.

## Outstanding owner input

- Official domain/subdomain and DNS control.
- Apple Developer ID credentials for signed distribution.

## Current evidence

- beta.5 bundles models but launches pip console scripts containing CI paths; not suitable for zero-setup marketing.
- Existing server has Caddy and other live services; deploy to an isolated directory and validate configuration before reload.
