/**
 * Talise waitlist confirmation email.
 *
 * Rendered to HTML via @react-email/render before being handed to the
 * Resend client.
 *
 * Design goals:
 *   - Light theme that renders predictably across Gmail, Apple Mail,
 *     and Outlook. We explicitly opt out of Gmail's dark-mode
 *     auto-inversion via the color-scheme meta tags below, because
 *     auto-inverted light emails look broken.
 *   - Structure inspired by Luma/Stripe transactional emails: header
 *     wordmark, large greeting, body block, single CTA, subtle footer.
 *   - One CTA only: the litepaper link. Black pill on white for the
 *     "premium" Stripe/Linear feel.
 *
 * Copy rules (load-bearing):
 *   1. No em dashes anywhere.
 *   2. Tight. Quick to read.
 *   3. Plain English, no marketing fluff.
 */
import {
  Body,
  Container,
  Head,
  Heading,
  Hr,
  Html,
  Img,
  Link,
  Preview,
  Section,
  Text,
} from "@react-email/components";

export type WaitlistConfirmationProps = {
  /** Optional first name captured from the form. */
  name?: string | null;
  /** Public base URL for absolute links (litepaper, signup URL). */
  appUrl: string;
};

const COLORS = {
  bg: "#FFFFFF",
  surface: "#F7F7F8",
  fg: "#0A0A0A",
  fgMuted: "#52525B",
  fgDim: "#A1A1AA",
  accent: "#0A0A0A",
  accentText: "#FFFFFF",
  line: "#E4E4E7",
};

const FONT_STACK =
  "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif";

export function WaitlistConfirmation({
  name,
  appUrl,
}: WaitlistConfirmationProps) {
  const litepaperUrl = `${appUrl.replace(/\/$/, "")}/litepaper`;
  const greeting = name && name.trim().length > 0 ? `, ${name.trim()}` : "";

  return (
    <Html lang="en">
      <Head>
        {/*
          Minimal head. We intentionally do NOT set color-scheme meta
          tags or a <style> block: those interact badly with Gmail's
          dark-mode renderer, which forces text white over our
          background and produces an empty-looking email. Pure inline
          styles + explicit text colors render predictably across
          Gmail (light + dark mode), Apple Mail, and Outlook.
        */}
      </Head>
      <Preview>You are on the Talise waitlist.</Preview>
      <Body
        // bgcolor on body is honored by Gmail and Outlook.
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: COLORS.bg,
          color: COLORS.fg,
          fontFamily: FONT_STACK,
          WebkitFontSmoothing: "antialiased",
        }}
      >
        {/* Outer table forces the light background to fill the full
            client width even when Gmail wraps the message in a
            content card. */}
        <Section

          style={{ backgroundColor: COLORS.bg, padding: "32px 0 48px 0" }}
        >
          <Container
            style={{
              maxWidth: "560px",
              width: "100%",
              margin: "0 auto",
              backgroundColor: COLORS.bg,
            }}
          >
            {/* Header: real Talise glyph (PNG, 1x + 2x) + wordmark.
                PNG hosted on the public Next.js public/ folder so it
                renders in Gmail / Outlook / Apple Mail without needing
                inline SVG support. The glyph is the actual brand
                symbol from /public/symbol.svg, rasterized via resvg. */}
            <Section
              style={{
                padding: "0 32px 28px 32px",
                backgroundColor: COLORS.bg,
              }}
            >
              <table
                role="presentation"
                cellPadding={0}
                cellSpacing={0}
                border={0}
                style={{ borderCollapse: "collapse" }}
              >
                <tbody>
                  <tr>
                    <td style={{ verticalAlign: "middle", paddingRight: "10px" }}>
                      <Img
                        src={`${appUrl.replace(/\/$/, "")}/symbol.png`}
                        srcSet={`${appUrl.replace(/\/$/, "")}/symbol.png 1x, ${appUrl.replace(/\/$/, "")}/symbol@2x.png 2x`}
                        alt=""
                        width={24}
                        height={22}
                        style={{
                          display: "block",
                          border: 0,
                          outline: "none",
                          textDecoration: "none",
                        }}
                      />
                    </td>
                    <td style={{ verticalAlign: "middle" }}>
                      <Text
                        className="talise-wordmark"
                        style={{
                          margin: 0,
                          fontSize: "17px",
                          fontWeight: 500,
                          color: COLORS.fg,
                          lineHeight: 1,
                          letterSpacing: "-0.01em",
                        }}
                      >
                        talise
                      </Text>
                    </td>
                  </tr>
                </tbody>
              </table>
            </Section>

            {/* Heading. */}
            <Section

              style={{
                padding: "0 32px 0 32px",
                backgroundColor: COLORS.bg,
              }}
            >
              <Heading
                as="h1"
                style={{
                  margin: 0,
                  fontSize: "32px",
                  lineHeight: 1.12,
                  letterSpacing: "-0.02em",
                  fontWeight: 500,
                  color: COLORS.fg,
                }}
              >
                You are on the list{greeting}.
              </Heading>
            </Section>

            {/* Body paragraphs. */}
            <Section

              style={{
                padding: "20px 32px 0 32px",
                backgroundColor: COLORS.bg,
              }}
            >
              <Text
                style={{
                  margin: "0 0 16px 0",
                  fontSize: "15px",
                  lineHeight: 1.6,
                  color: COLORS.fgMuted,
                }}
              >
                Thanks for joining the Talise waitlist. We are letting people
                in privately, in small batches, while we get the product ready
                for the African remittance corridor.
              </Text>
              <Text
                style={{
                  margin: "0 0 0 0",
                  fontSize: "15px",
                  lineHeight: 1.6,
                  color: COLORS.fgMuted,
                }}
              >
                When it is your turn we will send one short email with a
                sign-in link. You will not hear from us between now and then.
              </Text>
            </Section>

            {/* What Talise does, in a subtle card. */}
            <Section

              style={{
                margin: "28px 32px 0 32px",
                padding: "20px 22px",
                backgroundColor: COLORS.surface,
                borderRadius: "12px",
                border: `1px solid ${COLORS.line}`,
              }}
            >
              <Text
                style={{
                  margin: "0 0 14px 0",
                  fontSize: "10px",
                  letterSpacing: "0.2em",
                  textTransform: "uppercase",
                  color: COLORS.fgDim,
                  fontWeight: 600,
                }}
              >
                What Talise does
              </Text>
              <Row
                label="Username that holds dollars."
                value="Send to alice@talise.sui and any coin lands as USDsui."
              />
              <Row
                label="Cross-border in seconds."
                value="No wires, no Swift codes, no agent queues."
              />
              <Row
                label="Idle dollars earn yield."
                value="Withdraw anytime."
                last
              />
            </Section>

            {/* CTA: black pill, Stripe/Linear style on light. */}
            <Section

              style={{
                padding: "32px 32px 0 32px",
                backgroundColor: COLORS.bg,
              }}
            >
              <Link
                href={litepaperUrl}
                style={{
                  display: "inline-block",
                  color: COLORS.accentText,
                  textDecoration: "none",
                  fontSize: "14px",
                  fontWeight: 600,
                  padding: "12px 22px",
                  borderRadius: "999px",
                  backgroundColor: COLORS.accent,
                }}
              >
                Read the litepaper
              </Link>
            </Section>

            <Hr
              style={{
                borderColor: COLORS.line,
                borderTop: `1px solid ${COLORS.line}`,
                borderBottom: "none",
                margin: "44px 32px 18px 32px",
              }}
            />

            {/* Footer. */}
            <Section

              style={{
                padding: "0 32px 0 32px",
                backgroundColor: COLORS.bg,
              }}
            >
              <Text
                style={{
                  margin: "0 0 6px 0",
                  fontSize: "12px",
                  lineHeight: 1.6,
                  color: COLORS.fgDim,
                }}
              >
                Talise, Inc. Built on Sui. © 2026.
              </Text>
              <Text
                style={{
                  margin: "0 0 8px 0",
                  fontSize: "12px",
                  lineHeight: 1.6,
                  color: COLORS.fgDim,
                }}
              >
                You are receiving this because you signed up at{" "}
                <Link
                  href="https://talise.io/waitlist"
                  style={{
                    color: COLORS.fgMuted,
                    textDecoration: "underline",
                  }}
                >
                  talise.io/waitlist
                </Link>
                .
              </Text>
              <Text
                style={{
                  margin: 0,
                  fontSize: "12px",
                  lineHeight: 1.6,
                  color: COLORS.fgDim,
                }}
              >
                Reply to this email to remove yourself from the list.
              </Text>
            </Section>
          </Container>
        </Section>
      </Body>
    </Html>
  );
}

/**
 * Two-line row used in the "What Talise does" card. The label is the
 * primary foreground color, the value is muted, both stacked tight.
 * Avoids dash bullets which render inconsistently across clients.
 */
function Row({
  label,
  value,
  last,
}: {
  label: string;
  value: string;
  last?: boolean;
}) {
  return (
    <div style={{ marginBottom: last ? 0 : "14px" }}>
      <Text
        style={{
          margin: "0 0 2px 0",
          fontSize: "14px",
          lineHeight: 1.45,
          color: COLORS.fg,
          fontWeight: 500,
        }}
      >
        {label}
      </Text>
      <Text
        style={{
          margin: 0,
          fontSize: "13px",
          lineHeight: 1.5,
          color: COLORS.fgMuted,
        }}
      >
        {value}
      </Text>
    </div>
  );
}

export default WaitlistConfirmation;
