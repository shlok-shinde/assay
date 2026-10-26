import Link from "next/link";

export default function Home() {
  return (
    <main className="p-10">
      <Link href="/app/new?sample=instagram-launch" className="btn btn-primary">Start the demo, no sign-up</Link>
    </main>
  );
}
