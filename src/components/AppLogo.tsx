interface AppLogoProps {
  readonly size?: "sm" | "md" | "lg";
  readonly className?: string;
}

const SIZE_CLASS = {
  sm: "h-6 w-6",
  md: "h-9 w-9",
  lg: "h-14 w-14",
} as const;

export function AppLogo({ size = "md", className = "" }: Readonly<AppLogoProps>) {
  return (
    <img
      src="/logo.png"
      alt=""
      aria-hidden
      className={`${SIZE_CLASS[size]} shrink-0 rounded-md object-cover ${className}`.trim()}
    />
  );
}
