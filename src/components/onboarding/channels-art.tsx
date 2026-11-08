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
          <Icon name="instagram" size={38} />
        </span>
        <span className="onboarding-art-tile is-whatsapp">
          <Icon name="whatsapp" size={36} />
        </span>
        <span className="onboarding-art-spark">
          <Icon name="spark" size={20} />
        </span>
      </div>
    </div>
  );
}
