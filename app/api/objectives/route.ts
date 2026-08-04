// Adapter for the original api/objectives.js (seller listing objectives /
// milestones feature, called from sellers-transfer.js). Copied
// byte-for-byte — no relative imports needed repointing.
import legacyHandler from "./_handler";
import { runLegacyHandler } from "../_lib/legacyAdapter";

export async function POST(request: Request) {
  return runLegacyHandler(request, legacyHandler);
}
