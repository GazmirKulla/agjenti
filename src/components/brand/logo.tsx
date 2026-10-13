import Image from "next/image";

type BrandLogoProps = {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  priority?: boolean;
};

/** Transparent mint mark with a wordmark that inherits the current theme. */
export function BrandLogo({
  size = 34,
  withWordmark = true,
  className = "",
  priority = false,
}: BrandLogoProps) {
  const alt = withWordmark ? "" : "Agjenti.app";
  return (
    <span className={`brand-logo ${className}`.trim()}>
      <span className="brand-logo-mark" style={{ width: size, height: size }}>
        <Image
          src="/brand/mint-mark.webp"
          alt={alt}
          width={size}
          height={size}
          priority={priority}
        />
      </span>
      {withWordmark ? (
        <span className="brand-logo-text">agjenti.app</span>
      ) : null}
    </span>
  );
}
