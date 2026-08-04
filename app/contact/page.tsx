import type { Metadata } from "next";
import { getPublicBaseUrl } from "@/lib/server/adminDb";
import { staticOgImage, SUPPORT_OG_IMAGE } from "@/lib/og/staticOgImage";
import ContactForm from "./ContactForm";

// Split into a server page (for metadata) + client form (ContactForm.tsx,
// which needs useState for the live form fields and Firestore submit).
// Same pattern as terms/buyer-protection/how-it-works/about.
const TITLE = "Contact Us — Get in touch | Siterifty";
const DESCRIPTION =
  "Have a question about a listing, a deal, or your account? Send Siterifty support a message and we'll get back to you by email.";

export function generateMetadata(): Metadata {
  const url = `${getPublicBaseUrl()}/contact`;
  return {
    title: TITLE,
    description: DESCRIPTION,
    alternates: { canonical: url },
    openGraph: {
      title: TITLE,
      description: DESCRIPTION,
      url,
      type: "website",
      images: staticOgImage(SUPPORT_OG_IMAGE, "Siterifty Support").openGraphImages,
    },
    twitter: {
      card: "summary_large_image",
      title: TITLE,
      description: DESCRIPTION,
      images: staticOgImage(SUPPORT_OG_IMAGE, "Siterifty Support").twitterImages,
    },
  };
}

export default function ContactPage() {
  return <ContactForm />;
}
