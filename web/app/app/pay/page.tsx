import { Suspense } from "react";
import { SendFlow } from "@/components/app/pay/SendFlow";

/**
 * /app/pay — Send is the default Pay landing.
 *
 * The full multi-step send flow (amount → recipient → review → confirm) lives
 * in the SendFlow client component. It reads `?to=&amount=` for deep-link
 * prefill (the public /pay/<handle> link and Home quick-send), so it must sit
 * under a Suspense boundary (useSearchParams).
 */
export default function PayPage() {
  return (
    <Suspense fallback={null}>
      <SendFlow />
    </Suspense>
  );
}
