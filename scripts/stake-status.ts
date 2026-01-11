#!/usr/bin/env ts-node
/**
 * Nova Staking - Stake Status Script
 *
 * Connects to devnet and displays staking information for a user.
 *
 * Usage:
 *   npx ts-node scripts/stake-status.ts [OPTIONS]
 *
 * Options:
 *   --mint <PUBKEY>     NOVA token mint address (required)
 *   --user <PUBKEY>     User wallet address (optional, defaults to wallet)
 *   --help              Show this help message
 *
 * Environment:
 *   SOLANA_WALLET       Path to wallet keypair JSON (optional)
 *                       Defaults to ~/.config/solana/id.json
 *
 * Example:
 *   npx ts-node scripts/stake-status.ts --mint <NOVA_MINT_PUBKEY>
 *   npx ts-node scripts/stake-status.ts --mint <MINT> --user <USER_PUBKEY>
 */

import * as anchor from "@coral-xyz/anchor";
import { Program, BN } from "@coral-xyz/anchor";
import { Connection, PublicKey, Keypair, clusterApiUrl } from "@solana/web3.js";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";

// Program ID (must match deployed program)
const PROGRAM_ID = new PublicKey("Fg6PaFpoGXkYsidMpWTK6W2BeZ7FEfcYkg476zPFsLnS");

// Seeds for PDA derivation
const STAKE_POOL_SEED = Buffer.from("stake_pool");
const USER_STAKE_SEED = Buffer.from("user_stake");

// Time constants
const SECONDS_PER_DAY = 86400;
const SECONDS_PER_YEAR = 365 * SECONDS_PER_DAY;
const CORE_LOCK_PERIOD = 90 * SECONDS_PER_DAY;
const PRIME_LOCK_PERIOD = 180 * SECONDS_PER_DAY;

// Basis points
const BASIS_POINTS = 10000;

// Tier names
const TIER_NAMES: { [key: number]: string } = {
  0: "Flex (No Lock)",
  1: "Core (90 days)",
  2: "Prime (180 days)",
};

// IDL type definitions (minimal for reading accounts)
interface StakePoolAccount {
  authority: PublicKey;
  stakingMint: PublicKey;
  stakingVault: PublicKey;
  treasuryVault: PublicKey;
  flexApy: number;
  coreApy: number;
  primeApy: number;
  emissionCap: BN;
  totalDistributed: BN;
  totalStaked: BN;
  stakerCount: BN;
  paused: boolean;
  createdAt: BN;
  lastUpdated: BN;
  bump: number;
  vaultBump: number;
  treasuryBump: number;
}

interface UserStakeAccount {
  owner: PublicKey;
  stakePool: PublicKey;
  stakedAmount: BN;
  tier: number;
  stakeStartTime: BN;
  lastClaimTime: BN;
  totalRewardsClaimed: BN;
  pendingRewards: BN;
  isActive: boolean;
  bump: number;
}

/**
 * Load wallet keypair from file
 */
function loadWallet(): Keypair {
  // Check environment variable first
  const walletPath =
    process.env.SOLANA_WALLET ||
    path.join(os.homedir(), ".config", "solana", "id.json");

  try {
    const walletData = fs.readFileSync(walletPath, "utf-8");
    const secretKey = Uint8Array.from(JSON.parse(walletData));
    return Keypair.fromSecretKey(secretKey);
  } catch (error) {
    console.error(`\n❌ Error loading wallet from: ${walletPath}`);
    console.error("   Set SOLANA_WALLET env var or create default keypair with:");
    console.error("   solana-keygen new\n");
    process.exit(1);
  }
}

/**
 * Parse command line arguments
 */
function parseArgs(): { mint: PublicKey | null; user: PublicKey | null; help: boolean } {
  const args = process.argv.slice(2);
  let mint: PublicKey | null = null;
  let user: PublicKey | null = null;
  let help = false;

  for (let i = 0; i < args.length; i++) {
    switch (args[i]) {
      case "--mint":
        if (args[i + 1]) {
          try {
            mint = new PublicKey(args[i + 1]);
            i++;
          } catch {
            console.error(`Invalid mint address: ${args[i + 1]}`);
            process.exit(1);
          }
        }
        break;
      case "--user":
        if (args[i + 1]) {
          try {
            user = new PublicKey(args[i + 1]);
            i++;
          } catch {
            console.error(`Invalid user address: ${args[i + 1]}`);
            process.exit(1);
          }
        }
        break;
      case "--help":
      case "-h":
        help = true;
        break;
    }
  }

  return { mint, user, help };
}

/**
 * Show help message
 */
function showHelp(): void {
  console.log(`
Nova Staking - Stake Status Script

USAGE:
  npx ts-node scripts/stake-status.ts [OPTIONS]

OPTIONS:
  --mint <PUBKEY>     NOVA token mint address (required)
  --user <PUBKEY>     User wallet address (optional, defaults to wallet)
  --help, -h          Show this help message

ENVIRONMENT:
  SOLANA_WALLET       Path to wallet keypair JSON file
                      Defaults to ~/.config/solana/id.json

EXAMPLES:
  # Check your own stake status
  npx ts-node scripts/stake-status.ts --mint <NOVA_MINT_PUBKEY>

  # Check another user's stake status
  npx ts-node scripts/stake-status.ts --mint <MINT> --user <USER_PUBKEY>
`);
}

/**
 * Derive StakePool PDA
 */
function deriveStakePoolPda(mint: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [STAKE_POOL_SEED, mint.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Derive UserStake PDA
 */
function deriveUserStakePda(
  stakePool: PublicKey,
  user: PublicKey
): [PublicKey, number] {
  return PublicKey.findProgramAddressSync(
    [USER_STAKE_SEED, stakePool.toBuffer(), user.toBuffer()],
    PROGRAM_ID
  );
}

/**
 * Get lock period for tier (in seconds)
 */
function getLockPeriod(tier: number): number {
  switch (tier) {
    case 0:
      return 0; // Flex
    case 1:
      return CORE_LOCK_PERIOD; // Core
    case 2:
      return PRIME_LOCK_PERIOD; // Prime
    default:
      return 0;
  }
}

/**
 * Calculate estimated accrued rewards using integer math
 */
function calculateAccruedRewards(
  stakedAmount: BN,
  apyBasisPoints: number,
  lastClaimTime: BN,
  currentTime: number
): BN {
  const timeElapsed = currentTime - lastClaimTime.toNumber();
  if (timeElapsed <= 0 || stakedAmount.isZero()) {
    return new BN(0);
  }

  // rewards = stakedAmount * apy * timeElapsed / (BASIS_POINTS * SECONDS_PER_YEAR)
  const apy = new BN(apyBasisPoints);
  const time = new BN(timeElapsed);
  const basisPoints = new BN(BASIS_POINTS);
  const yearSeconds = new BN(SECONDS_PER_YEAR);

  return stakedAmount.mul(apy).mul(time).div(basisPoints.mul(yearSeconds));
}

/**
 * Format timestamp to readable date
 */
function formatTimestamp(timestamp: number): string {
  if (timestamp === 0) return "N/A";
  return new Date(timestamp * 1000).toISOString().replace("T", " ").slice(0, 19) + " UTC";
}

/**
 * Format duration in seconds to human readable
 */
function formatDuration(seconds: number): string {
  if (seconds <= 0) return "No lock";

  const days = Math.floor(seconds / SECONDS_PER_DAY);
  const hours = Math.floor((seconds % SECONDS_PER_DAY) / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);

  const parts: string[] = [];
  if (days > 0) parts.push(`${days}d`);
  if (hours > 0) parts.push(`${hours}h`);
  if (minutes > 0) parts.push(`${minutes}m`);

  return parts.length > 0 ? parts.join(" ") : "< 1m";
}

/**
 * Format token amount (assuming 6 decimals)
 */
function formatTokenAmount(amount: BN, decimals: number = 6): string {
  const divisor = new BN(10).pow(new BN(decimals));
  const whole = amount.div(divisor);
  const fraction = amount.mod(divisor);

  const fractionStr = fraction.toString().padStart(decimals, "0");
  return `${whole.toString()}.${fractionStr}`;
}

/**
 * Main function
 */
async function main(): Promise<void> {
  const { mint, user, help } = parseArgs();

  if (help) {
    showHelp();
    process.exit(0);
  }

  if (!mint) {
    console.error("❌ Error: --mint is required\n");
    showHelp();
    process.exit(1);
  }

  // Load wallet
  const wallet = loadWallet();
  const userPubkey = user || wallet.publicKey;

  console.log("\n" + "=".repeat(60));
  console.log("  NOVA STAKING - STATUS CHECK");
  console.log("=".repeat(60));

  // Connect to devnet
  const connection = new Connection(clusterApiUrl("devnet"), "confirmed");
  console.log("\n📡 Connected to: Solana Devnet");
  console.log(`👛 Wallet: ${wallet.publicKey.toBase58()}`);
  console.log(`👤 Checking user: ${userPubkey.toBase58()}`);
  console.log(`🪙 Token mint: ${mint.toBase58()}`);

  // Derive PDAs
  const [stakePoolPda] = deriveStakePoolPda(mint);
  const [userStakePda] = deriveUserStakePda(stakePoolPda, userPubkey);

  console.log(`\n📍 Stake Pool PDA: ${stakePoolPda.toBase58()}`);
  console.log(`📍 User Stake PDA: ${userStakePda.toBase58()}`);

  // Fetch StakePool account
  console.log("\n" + "-".repeat(60));
  console.log("  STAKE POOL INFO");
  console.log("-".repeat(60));

  try {
    const stakePoolInfo = await connection.getAccountInfo(stakePoolPda);

    if (!stakePoolInfo) {
      console.log("\n❌ Stake pool not found. Pool may not be initialized.");
      console.log("   Make sure the mint address is correct.\n");
      process.exit(1);
    }

    // Decode account data (skip 8-byte discriminator)
    const data = stakePoolInfo.data.slice(8);

    // Parse StakePool (manual parsing based on account structure)
    const authority = new PublicKey(data.slice(0, 32));
    const stakingMint = new PublicKey(data.slice(32, 64));
    const stakingVault = new PublicKey(data.slice(64, 96));
    const treasuryVault = new PublicKey(data.slice(96, 128));
    const flexApy = data.readUInt16LE(128);
    const coreApy = data.readUInt16LE(130);
    const primeApy = data.readUInt16LE(132);
    const emissionCap = new BN(data.slice(134, 142), "le");
    const totalDistributed = new BN(data.slice(142, 150), "le");
    const totalStaked = new BN(data.slice(150, 158), "le");
    const stakerCount = new BN(data.slice(158, 166), "le");
    const paused = data[166] === 1;
    const createdAt = new BN(data.slice(167, 175), "le");
    const lastUpdated = new BN(data.slice(175, 183), "le");

    console.log(`\n  Authority:        ${authority.toBase58()}`);
    console.log(`  Staking Mint:     ${stakingMint.toBase58()}`);
    console.log(`  Status:           ${paused ? "⏸️  PAUSED" : "✅ ACTIVE"}`);
    console.log(`  Total Staked:     ${formatTokenAmount(totalStaked)} NOVA`);
    console.log(`  Total Stakers:    ${stakerCount.toString()}`);
    console.log(`  Total Distributed: ${formatTokenAmount(totalDistributed)} NOVA`);
    console.log(`  Emission Cap:     ${formatTokenAmount(emissionCap)} NOVA`);
    console.log(`  Remaining Cap:    ${formatTokenAmount(emissionCap.sub(totalDistributed))} NOVA`);
    console.log(`\n  APY Rates:`);
    console.log(`    Flex:           ${(flexApy / 100).toFixed(2)}%`);
    console.log(`    Core:           ${(coreApy / 100).toFixed(2)}%`);
    console.log(`    Prime:          ${(primeApy / 100).toFixed(2)}%`);
    console.log(`\n  Pool Created:     ${formatTimestamp(createdAt.toNumber())}`);
    console.log(`  Last Updated:     ${formatTimestamp(lastUpdated.toNumber())}`);

    // Fetch UserStake account
    console.log("\n" + "-".repeat(60));
    console.log("  USER STAKE INFO");
    console.log("-".repeat(60));

    const userStakeInfo = await connection.getAccountInfo(userStakePda);

    if (!userStakeInfo) {
      console.log("\n⚠️  No stake found for this user.");
      console.log("   User has not staked in this pool.\n");
      process.exit(0);
    }

    // Decode user stake data (skip 8-byte discriminator)
    const userData = userStakeInfo.data.slice(8);

    // Parse UserStake
    const owner = new PublicKey(userData.slice(0, 32));
    const stakePool = new PublicKey(userData.slice(32, 64));
    const stakedAmount = new BN(userData.slice(64, 72), "le");
    const tier = userData[72];
    const stakeStartTime = new BN(userData.slice(73, 81), "le");
    const lastClaimTime = new BN(userData.slice(81, 89), "le");
    const totalRewardsClaimed = new BN(userData.slice(89, 97), "le");
    const pendingRewards = new BN(userData.slice(97, 105), "le");
    const isActive = userData[105] === 1;

    // Calculate lock end time
    const lockPeriod = getLockPeriod(tier);
    const lockEndTime = stakeStartTime.toNumber() + lockPeriod;
    const currentTime = Math.floor(Date.now() / 1000);
    const isLockEnded = tier === 0 || currentTime >= lockEndTime;

    // Get APY for this tier
    const apyForTier = tier === 0 ? flexApy : tier === 1 ? coreApy : primeApy;

    // Calculate estimated accrued rewards
    const estimatedRewards = calculateAccruedRewards(
      stakedAmount,
      apyForTier,
      lastClaimTime,
      currentTime
    );
    const totalPending = pendingRewards.add(estimatedRewards);

    console.log(`\n  Owner:            ${owner.toBase58()}`);
    console.log(`  Status:           ${isActive ? "✅ ACTIVE" : "❌ INACTIVE"}`);
    console.log(`  Tier:             ${TIER_NAMES[tier] || `Unknown (${tier})`}`);
    console.log(`  APY:              ${(apyForTier / 100).toFixed(2)}%`);
    console.log(`\n  💰 Staked Amount:  ${formatTokenAmount(stakedAmount)} NOVA`);
    console.log(`\n  ⏰ Time Info:`);
    console.log(`    Stake Start:    ${formatTimestamp(stakeStartTime.toNumber())}`);
    console.log(`    Last Claim:     ${formatTimestamp(lastClaimTime.toNumber())}`);

    if (tier === 0) {
      console.log(`    Lock End:       No lock (Flex tier)`);
      console.log(`    Lock Status:    ✅ Can unstake anytime`);
    } else {
      console.log(`    Lock End:       ${formatTimestamp(lockEndTime)}`);
      if (isLockEnded) {
        console.log(`    Lock Status:    ✅ Lock period ended`);
      } else {
        const remaining = lockEndTime - currentTime;
        console.log(`    Lock Status:    🔒 Locked (${formatDuration(remaining)} remaining)`);
      }
    }

    console.log(`\n  🎁 Rewards:`);
    console.log(`    Already Claimed: ${formatTokenAmount(totalRewardsClaimed)} NOVA`);
    console.log(`    Stored Pending:  ${formatTokenAmount(pendingRewards)} NOVA`);
    console.log(`    Est. Accrued:    ${formatTokenAmount(estimatedRewards)} NOVA`);
    console.log(`    Total Claimable: ${formatTokenAmount(totalPending)} NOVA`);

    // Summary
    console.log("\n" + "=".repeat(60));
    console.log("  SUMMARY");
    console.log("=".repeat(60));

    const canUnstake = tier === 0 || isLockEnded;
    const canClaim = totalPending.gt(new BN(0));

    console.log(`\n  Can Unstake:      ${canUnstake ? "✅ Yes" : "❌ No (locked)"}`);
    console.log(`  Can Claim:        ${canClaim ? "✅ Yes" : "⚠️  No rewards"}`);
    console.log("");

  } catch (error: any) {
    console.error(`\n❌ Error: ${error.message}\n`);
    process.exit(1);
  }
}

// Run main
main().catch((error) => {
  console.error("Fatal error:", error);
  process.exit(1);
});
