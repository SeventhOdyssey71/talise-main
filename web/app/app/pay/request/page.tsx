import { RequestPanel } from "@/components/app/pay/RequestPanel";

/**
 * /app/pay/request — Receive a payment.
 *
 * Two modes: a plain receive QR (`sui:<address>`) and a request builder that
 * produces a shareable `/pay/<handle>?amount=&memo=` payment link with its own
 * QR. All client-side (RequestPanel).
 */
export default function RequestPage() {
  return <RequestPanel />;
}
