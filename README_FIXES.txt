FIX — deploy to the SAME relative path, overwrite the original.

lib/useDealChat.ts

WHAT BROKE
My earlier edit that added paymentRequestCooldownText/
isPaymentRequestOnCooldown accidentally replaced the
"export function deleteCountdownText(deleteAt: number): string {"
line instead of inserting before it — deleting that function's
signature while leaving its body behind, which broke the build
("Return statement is not allowed here").

WHAT'S FIXED
deleteCountdownText's signature is restored. All functions from the
payment-request cooldown fix (paymentRequestCooldownText,
isPaymentRequestOnCooldown) are intact and unchanged in behavior —
only the accidental deletion is fixed. Verified brace-balanced.
