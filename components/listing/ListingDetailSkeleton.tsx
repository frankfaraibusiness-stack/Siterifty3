export default function ListingDetailSkeleton() {
  return (
    <div style={{ padding: "24px 24px 80px", maxWidth: 760, margin: "92px auto 0" }}>
      <div className="skel-block" style={{ height: 320, borderRadius: 16, marginBottom: 16 }} />
      <div className="skel-fins-row" style={{ marginBottom: 16 }}>
        <div className="skel-block" />
        <div className="skel-block" />
        <div className="skel-block" />
      </div>
      <div className="skel-block skel-text lg" style={{ width: "60%", marginBottom: 10 }} />
      <div className="skel-block skel-text" style={{ width: "100%", marginBottom: 6 }} />
      <div className="skel-block skel-text" style={{ width: "92%", marginBottom: 6 }} />
      <div className="skel-block skel-text" style={{ width: "78%", marginBottom: 24 }} />
      <div className="skel-fins-row" style={{ marginBottom: 16 }}>
        <div className="skel-block" />
        <div className="skel-block" />
        <div className="skel-block" />
        <div className="skel-block" />
      </div>
      <div className="skel-block" style={{ height: 60, borderRadius: 12 }} />
    </div>
  );
}
