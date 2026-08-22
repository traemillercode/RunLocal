import { Link } from "react-router-dom";

/**
 * Terms of Service and Privacy Policy — combined into one page (two sections,
 * one shared layout) rather than two separate routes, since most small
 * platforms present them together and it halves the surface area to keep in
 * sync. Static content, no data fetching.
 *
 * IMPORTANT: this is a genuine, substantive starting draft covering the
 * real risk areas specific to this app (in-person meetups, identity
 * verification via selfie, location data, messaging, third-party
 * integrations) — but it is not a substitute for review by an actual
 * lawyer before being treated as final or binding. Update the "Last
 * updated" date whenever the content changes.
 */
export function LegalPage() {
  return (
    <div className="mx-auto max-w-2xl px-4 py-8">
      <Link to="/" className="text-[13px] font-bold text-slate-500 hover:underline underline-offset-2">
        ← Back to Kimbio
      </Link>
      <h1 className="mt-4 text-2xl font-extrabold tracking-tight text-slate-900">Terms of Service &amp; Privacy Policy</h1>
      <p className="mt-1 text-[13px] text-slate-500">Last updated: August 22, 2026</p>

      <section id="terms" className="mt-8 space-y-5 text-[14px] leading-relaxed text-slate-700">
        <h2 className="text-lg font-extrabold text-slate-900">Terms of Service</h2>

        <div>
          <h3 className="font-bold text-slate-900">1. What Kimbio is</h3>
          <p>Kimbio helps runners find group runs, races, and running communities, starting in Columbia, Missouri. Kimbio is a platform that connects people — it does not organize, supervise, or guarantee the safety of any run, race, or in-person event listed or discussed on it.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">2. Running is physical activity with real risk</h3>
          <p>Group runs, races, and any other in-person activity you find through Kimbio carry inherent risks, including but not limited to injury from traffic, terrain, weather, other participants, or your own physical condition. By participating in any run or event coordinated through Kimbio, you do so voluntarily and at your own risk. Kimbio is not responsible for injuries, accidents, or incidents that occur during or in connection with any run, race, or meetup — whether or not it was created, hosted, or promoted through the platform.</p>
          <p className="mt-2">Some events may require a separate liability waiver from the organizing club or race director. That waiver, not this document, governs your participation in that specific event.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">3. Identity verification</h3>
          <p>Creating a full account requires submitting a selfie photo for manual identity review. This exists to keep the community made up of real people, since Kimbio is used to coordinate meeting strangers in person. Your selfie is reviewed by a human admin and is never used for automated facial recognition or shared with third parties. See the Privacy Policy section below for how long it's retained.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">4. Your account and conduct</h3>
          <p>You're responsible for what you post, message, and do under your account. You agree not to harass other users, post content that's illegal or intended to harm others, impersonate anyone, or use Kimbio to facilitate anything unrelated to its purpose as a running community platform. Accounts that violate this can be suspended or removed, with or without notice, at Kimbio's discretion.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">5. Content you post</h3>
          <p>You keep ownership of anything you post (forum posts, replies, messages, profile content). By posting it, you give Kimbio permission to display it on the platform to the audience you posted it for. You're responsible for making sure you have the right to post what you post.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">6. Manual logging, by design</h3>
          <p>Kimbio does not sync automatically with Strava, Garmin, or any other fitness service. Every run you log — distance, pace, surface, photos, voice notes — is entered intentionally by you. This is a deliberate product choice, not a missing feature.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">7. No guarantee of availability</h3>
          <p>Kimbio is provided as-is. We aim to keep it running reliably but don't guarantee uninterrupted access, and features may change or be removed as the platform develops.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">8. Changes to these terms</h3>
          <p>If these terms change in a material way, we'll update the date at the top of this page. Continued use of Kimbio after a change means you accept the updated terms.</p>
        </div>
      </section>

      <section id="privacy" className="mt-10 space-y-5 border-t border-slate-200 pt-8 text-[14px] leading-relaxed text-slate-700">
        <h2 className="text-lg font-extrabold text-slate-900">Privacy Policy</h2>

        <div>
          <h3 className="font-bold text-slate-900">1. What we collect</h3>
          <ul className="ml-4 list-disc space-y-1">
            <li><strong>Account info:</strong> name, email, phone (if provided), home city, username.</li>
            <li><strong>Identity verification:</strong> a selfie photo, submitted once for manual admin review.</li>
            <li><strong>Profile content you choose to add:</strong> bio, pace, goals, training notes, upcoming races, linked social accounts (only shown publicly if you turn that on).</li>
            <li><strong>Activity:</strong> RSVPs, forum posts and replies, messages you send, connections you make.</li>
            <li><strong>What you log manually:</strong> distance, pace, surface, photos, and voice notes you choose to add — Kimbio does not sync automatically with any fitness service.</li>
            <li><strong>Technical data:</strong> IP address at signup and login (used for safety and abuse prevention), device/browser info standard to any web app.</li>
          </ul>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">2. How we use it</h3>
          <p>To run the core product: show you relevant runs and races, connect you with other runners, let you message people you've connected with, and keep the community made up of real, identity-verified people. We also use it to send account-related emails (confirmations, password resets, verification decisions) and, if you opt in, notifications about upcoming runs and account activity.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">3. What we don't do</h3>
          <p>We don't sell your personal data. We don't use your selfie for facial recognition or share it outside the manual review process. We don't share your email, phone, or precise location with other users — your public profile only ever shows what you've explicitly chosen to make visible (photo, name, bio, and anything you've opted into sharing, like social links).</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">4. Who can see what</h3>
          <p>Other signed-in users can see your public profile (name, photo, city, bio if set, verification badge). Your email and phone number are never shown to other users. Selfie photos are visible only to admins during the review process. Forum posts are visible to other users in your city; direct messages are visible only to the people in that conversation.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">5. Data retention</h3>
          <p>We keep your data for as long as your account is active. If you delete your account, your personal data is removed from active use; some records may be retained briefly for legal, safety, or fraud-prevention purposes before being permanently purged.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">6. Your choices</h3>
          <p>You can edit or remove most profile information at any time from Settings, control which notification categories you receive, control whether your social links are shown publicly, disconnect third-party integrations, and delete your account entirely.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">7. Security</h3>
          <p>Data is encrypted in transit (HTTPS) and at rest. Access to sensitive data like selfie photos is restricted to admin review functions.</p>
        </div>

        <div>
          <h3 className="font-bold text-slate-900">8. Contact</h3>
          <p>Questions about this policy or your data can be sent to <a href="mailto:hello@getkimbio.com" className="font-semibold text-[#14171C] underline underline-offset-2">hello@getkimbio.com</a>.</p>
        </div>
      </section>
    </div>
  );
}
