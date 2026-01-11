#!/bin/bash
# Setup script for Nova Staking development environment
# Run this on a machine with proper Solana/Rust development setup

set -e

echo "=========================================="
echo "Nova Staking Development Setup"
echo "=========================================="

# Check for Rust
if ! command -v rustc &> /dev/null; then
    echo "Installing Rust..."
    curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh -s -- -y
    source "$HOME/.cargo/env"
fi
echo "Rust version: $(rustc --version)"

# Check for Solana CLI
if ! command -v solana &> /dev/null; then
    echo "Installing Solana CLI..."
    sh -c "$(curl -sSfL https://release.solana.com/v1.18.15/install)"
    export PATH="$HOME/.local/share/solana/install/active_release/bin:$PATH"
fi
echo "Solana version: $(solana --version)"

# Check for Anchor
if ! command -v anchor &> /dev/null; then
    echo "Installing Anchor..."
    cargo install --git https://github.com/coral-xyz/anchor avm --locked --force
    avm install latest
    avm use latest
fi
echo "Anchor version: $(anchor --version)"

# Configure for devnet
echo ""
echo "Configuring Solana for devnet..."
solana config set --url devnet

# Generate keypair if none exists
if [ ! -f ~/.config/solana/id.json ]; then
    echo "Generating new keypair..."
    solana-keygen new --no-bip39-passphrase
fi

# Airdrop SOL for testing
echo ""
echo "Requesting SOL airdrop for testing..."
solana airdrop 2

# Build the program
echo ""
echo "Building Nova Staking program..."
cd "$(dirname "$0")/.."
anchor build

echo ""
echo "=========================================="
echo "Setup complete!"
echo "=========================================="
echo ""
echo "Program ID: $(cat target/deploy/nova_staking-keypair.json | solana-keygen pubkey /dev/stdin 2>/dev/null || echo 'Build first to generate')"
echo ""
echo "Next steps:"
echo "  1. Update Program ID in Anchor.toml and lib.rs"
echo "  2. anchor build"
echo "  3. anchor deploy --provider.cluster devnet"
echo ""
