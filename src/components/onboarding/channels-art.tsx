import { Icon } from "@/components/dashboard/icon";

/** Sidebar welcome shared by the onboarding screens: the agent works on both
 * Instagram and WhatsApp conversations. */
export function OnboardingWelcome() {
  return (
    <div className="onboarding-welcome">
      <h2>
        Mirë se erdhe!
        <br />
        Le të fillojmë.
      </h2>
      <p>
        Lidh Instagram-in dhe WhatsApp-in, organizo produktet dhe kujdesu për
        klientët nga një vend.
      </p>
      <div className="onboarding-art" role="img" aria-label="Instagram dhe WhatsApp">
        <span className="onboarding-art-tile is-instagram">
          <Icon name="instagram" size={48} />
        </span>
        <span className="onboarding-art-tile is-whatsapp">
          <Icon name="whatsapp" size={46} />
        </span>
        <span className="onboarding-art-spark">
          <Icon name="spark" size={24} />
        </span>
      </div>
      <ul className="onboarding-channels" aria-label="Kanalet që mund të lidhësh">
        <li><Icon name="instagram" size={16} /> Instagram</li>
        <li><Icon name="whatsapp" size={16} /> WhatsApp</li>
      </ul>
    </div>
  );
}
