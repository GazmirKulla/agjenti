import Image from "next/image";

type BrandLogoProps = {
  size?: number;
  withWordmark?: boolean;
  className?: string;
  priority?: boolean;
};

/** Brand mark — light (`logo-mark`) and dark (`logo`) swap with the selected theme. */
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
          className="brand-logo-light"
          src="/brand/logo-mark.webp"
          alt={alt}
          width={size}
          height={size}
          priority={priority}
        />
        <Image
          className="brand-logo-dark"
          src="/brand/logo.webp"
          alt={alt}
          width={size}
          height={size}
          priority={priority}
        />
      </span>
      {withWordmark ? (
        <span className="brand-logo-text">Agjenti.app</span>
      ) : null}
    </span>
  );
}
