export const metadata = {
  title: "My Blog",
  description: "A small, simple blog built with Next.js",
};

export default function RootLayout({ children }) {
  return (
    <html lang="en">
      <body
        style={{
          maxWidth: "700px",
          margin: "0 auto",
          padding: "2rem 1rem",
          fontFamily: "Georgia, serif",
          lineHeight: 1.6,
          color: "#222",
        }}
      >
        <header style={{ marginBottom: "2rem" }}>
          <a
            href="/"
            style={{
              textDecoration: "none",
              color: "#222",
              fontSize: "1.5rem",
              fontWeight: "bold",
            }}
          >
            My Blog
          </a>
        </header>
        {children}
        <footer
          style={{
            marginTop: "3rem",
            paddingTop: "1rem",
            borderTop: "1px solid #ddd",
            fontSize: "0.85rem",
            color: "#888",
          }}
        >
          © {new Date().getFullYear()} My Blog
        </footer>
      </body>
    </html>
  );
}
