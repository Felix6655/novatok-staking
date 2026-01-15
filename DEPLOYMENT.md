# Nova Staking - Devnet Deployment Guide

This guide covers terminal-only deployment of the Nova Staking program to Solana devnet.

## Prerequisites

### Required Versions
- **Rust**: 1.75.0 or later
- **Solana CLI**: 1.18.x (tested with 1.18.22)
- **Anchor CLI**: 0.29.x (tested with 0.29.0)
- **Node.js**: 18.x or later
- **Yarn**: 1.x or later

---

## Step 1: Install Toolchain

### Install Rust
```bash
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
source "$HOME/.cargo/env"
rustc --version  # Should show 1.75.0+
```

### Install Solana CLI
```bash
# Option 1: Official installer (recommended)
sh -c "$(curl -sSfL https://release.solana.com/v1.18.22/install)"
export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"

# Add to shell profile
echo 'export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"' >> ~/.bashrc
source ~/.bashrc

solana --version  # Should show 1.18.22
```

### Install Anchor CLI
```bash
# Install AVM (Anchor Version Manager)
cargo install --git https://github.com/coral-xyz/anchor avm --locked --force

# Install and use Anchor 0.29.0
avm install 0.29.0
avm use 0.29.0

anchor --version  # Should show 0.29.0
```

### Install Node.js Dependencies
```bash
cd /path/to/novatok-staking
yarn install
```

---

## Step 2: Configure Solana for Devnet

```bash
# Set cluster to devnet
solana config set --url devnet

# Verify configuration
solana config get
# Output should show:
# RPC URL: https://api.devnet.solana.com
```

---

## Step 3: Create or Import Wallet

### Option A: Generate New Keypair
```bash
solana-keygen new --outfile ~/.config/solana/id.json
# IMPORTANT: Save your seed phrase securely!

# Get your public key
solana address
```

### Option B: Import Existing Keypair
```bash
# If you have a seed phrase:
solana-keygen recover --outfile ~/.config/solana/id.json

# If you have a private key array:
echo '[your,private,key,bytes]' > ~/.config/solana/id.json
```

---

## Step 4: Fund Wallet with SOL

```bash
# Request airdrop (devnet only, ~2 SOL per request)
solana airdrop 2

# Check balance
solana balance
# Need at least 5 SOL for deployment

# Request more if needed
solana airdrop 2
solana airdrop 1
```

---

## Step 5: Generate Program ID

```bash
# Navigate to project
cd /path/to/novatok-staking

# Build first to generate keypair
anchor build

# Get the generated program ID
solana-keygen pubkey target/deploy/nova_staking-keypair.json
# Example output: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
```

**IMPORTANT**: Copy this program ID for the next step!

---

## Step 6: Update Program ID

You must update the program ID in TWO places:

### 6a. Update Anchor.toml
```bash
# Edit Anchor.toml and replace ALL occurrences of the old ID
nano Anchor.toml
# or
vim Anchor.toml
```

Change:
```toml
[programs.localnet]
nova_staking = "YOUR_NEW_PROGRAM_ID"

[programs.devnet]
nova_staking = "YOUR_NEW_PROGRAM_ID"
```

### 6b. Update lib.rs
```bash
# Edit programs/nova_staking/src/lib.rs
nano programs/nova_staking/src/lib.rs
```

Change line 23:
```rust
declare_id!("YOUR_NEW_PROGRAM_ID");
```

**Replace `YOUR_NEW_PROGRAM_ID` with the output from Step 5.**

---

## Step 7: Rebuild Program

```bash
# Clean and rebuild with new program ID
anchor build

# Verify the program ID matches
solana-keygen pubkey target/deploy/nova_staking-keypair.json
# Should match what you put in lib.rs and Anchor.toml
```

---

## Step 8: Run Tests (Optional but Recommended)

```bash
# Start local validator in a separate terminal
solana-test-validator

# In main terminal, run tests
anchor test --skip-local-validator

# Or run all at once (starts validator automatically)
anchor test
```

All tests should pass. If any fail, check the error output.

---

## Step 9: Deploy to Devnet

```bash
# Deploy the program
anchor deploy --provider.cluster devnet

# Or using solana-cli directly:
solana program deploy target/deploy/nova_staking.so --program-id target/deploy/nova_staking-keypair.json
```

**Expected output:**
```
Deploying cluster: https://api.devnet.solana.com
Upgrade authority: <your-wallet>
Program Id: <your-program-id>
```

---

## Step 10: Verify Deployment

```bash
# Check program exists on-chain
solana program show <YOUR_PROGRAM_ID>

# Example:
solana program show 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU

# Should output something like:
# Program Id: 7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU
# Owner: BPFLoaderUpgradeab1e11111111111111111111111
# ProgramData Address: <data-account>
# Authority: <your-wallet>
# Last Deploy Slot: <slot>
# Data Length: <bytes>
```

---

## Troubleshooting

### "Insufficient funds"
```bash
solana airdrop 2  # Request more SOL
```

### "Program account already exists"
The program ID is already deployed. Either:
- Use `anchor upgrade` instead of `deploy`
- Generate a new keypair in `target/deploy/`

### "Account data too small"
You may need to extend the program account:
```bash
solana program extend <PROGRAM_ID> <ADDITIONAL_BYTES>
```

### "Custom program error: 0x0"
Check the specific error code against `error.rs` definitions.

---

## Post-Deployment

After successful deployment:

1. Save your program ID permanently
2. Update `.env` with the program ID
3. Run smoke tests (see SMOKE_TEST.md)
4. Consider setting up program upgrade authority multi-sig for production

---

## Quick Reference Commands

```bash
# Check Solana config
solana config get

# Check wallet balance
solana balance

# Check program info
solana program show <PROGRAM_ID>

# View program logs
solana logs <PROGRAM_ID>

# Upgrade program (after initial deploy)
anchor upgrade target/deploy/nova_staking.so --program-id <PROGRAM_ID>
```
