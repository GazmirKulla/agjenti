import { OnboardingExperience } from '@/components/onboarding/experience';
import { emptyAnswers } from '@/lib/onboarding/model';
import '../../onboarding/onboarding.css';
export default function Preview() { return <OnboardingExperience initial={emptyAnswers} initialStep={0} email="preview@example.test"/>; }
