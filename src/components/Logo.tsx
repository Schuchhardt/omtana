import Image from "next/image";
import Link from "next/link";

export function Logo({ href = "/", dark = false }: { href?: string; dark?: boolean }) {
  return (
    <Link href={href} className="mr-auto flex items-center gap-[11px]" aria-label="Omtana">
      <Image
        src="/brand/omtana-symbol-black.svg"
        alt=""
        width={26}
        height={26}
        className="block h-[26px] w-[26px]"
        priority
      />
      <Image
        src={dark ? "/brand/omtana-wordmark-white.svg" : "/brand/omtana-wordmark-black.svg"}
        alt="Omtana"
        width={92}
        height={19}
        className="block h-[19px] w-auto"
        priority
      />
    </Link>
  );
}
