# Nova Staking - Build Guide

## Prerequisites

### Required Versions
| Tool | Version | Notes |
|------|---------|-------|
| Rust | 1.79.0 | Pinned via `rust-toolchain.toml` |
| Solana CLI | 1.18.x | Tested with 1.18.22 |
| Anchor CLI | 0.29.0 | Must match `anchor-lang` crate version |
| Node.js | 18.x+ | For tests |
| Yarn | 1.x+ | For dependency management |

### Install Toolchain

```bash
# Install Rust
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"

# Install specific Rust version (handled by rust-toolchain.toml, but can be explicit)
rustup install 1.79.0
rustup default 1.79.0

# Install Solana CLI
sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Install Anchor CLI
cargo install --git https://github.com/coral-xyz/anchor --tag v0.29.0 anchor-cli --locked

# Install Node.js dependencies
yarn install
```

## Build Commands

```bash
# Verify versions
anchor --version    # anchor-cli 0.29.0
solana --version    # solana-cli 1.18.22
rustc -V            # rustc 1.79.0
cargo -V            # cargo 1.79.0

# Clean and build
anchor clean
anchor build

# Verify output
ls -la target/deploy/nova_staking.so
```

## Troubleshooting

### `edition2024` Error

**Symptom:**
```
error: feature `edition2024` is required
```

**Cause:** `blake3 v1.8.3` requires Rust edition 2024 which is only available in nightly.

**Solution:** The `Cargo.toml` patches pin `blake3` to v1.5.5 which doesn't require edition 2024:
```toml
[patch.crates-io]
blake3 = { git = "https://github.com/BLAKE3-team/BLAKE3", tag = "1.5.5" }
```

If this error persists:
1. Delete `Cargo.lock`: `rm Cargo.lock`
2. Regenerate: `cargo update`
3. Verify blake3 version: `cargo tree -p blake3` (should show v1.5.5)

### `constant_time_eq` MSRV Error

**Symptom:**
```
error: package `constant_time_eq v0.4.2` cannot be built because it requires rustc 1.85.0
```

**Cause:** Newer `constant_time_eq` versions require Rust 1.85+.

**Solution:** The `blake3 v1.5.5` patch automatically uses `constant_time_eq v0.3.1` (MSRV 1.66).

### `toml_parser` MSRV Error

**Symptom:**
```
error: package `toml_parser v1.0.6` cannot be built because it requires rustc 1.76.0
```

**Solution:** The `proc-macro-crate` patch to v3.2.0 uses `toml_edit v0.22` instead.

### `borsh-derive` MSRV Error

**Symptom:**
```
error: package `borsh-derive v1.6.0` cannot be built because it requires rustc 1.77.0
```

**Solution:** The `borsh` patch to v1.5.5 uses compatible borsh-derive.

## Dependency Patches Summary

All patches are in the workspace root `Cargo.toml`:

```toml
[patch.crates-io]
# Fix toml_parser MSRV (rustc 1.76 -> 1.65)
proc-macro-crate = { git = "https://github.com/bkchr/proc-macro-crate", tag = "v3.2.0" }

# Fix borsh-derive MSRV (rustc 1.77 -> 1.72)
borsh = { git = "https://github.com/near/borsh-rs", tag = "borsh-v1.5.5" }

# Fix constant_time_eq MSRV (rustc 1.85 -> 1.66)
blake3 = { git = "https://github.com/BLAKE3-team/BLAKE3", tag = "1.5.5" }
```

## Deployment

See [DEPLOYMENT.md](./DEPLOYMENT.md) for devnet deployment instructions.

## Cargo.lock Policy

The `Cargo.lock` is committed to ensure reproducible builds. If you need to regenerate it:

```bash
rm Cargo.lock
cargo update

# Pin versions for rustc 1.79 compatibility
cargo update -p rayon --precise 1.8.1
cargo update -p rayon-core --precise 1.12.1
cargo update -p indexmap --precise 2.6.0

# Verify no MSRV errors
cargo tree -p blake3    # Should show v1.5.5
cargo tree -p borsh     # Should show v1.5.5 for borsh v1.x
anchor build
```
