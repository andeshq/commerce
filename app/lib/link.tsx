import type { ComponentProps } from "react";
import { Link as HeroLink } from "@heroui/react";
import { useHref } from "react-router";

type HeroLinkProps = ComponentProps<typeof HeroLink>;

/**
 * HeroUI Link with a basename-aware `href`. React Aria renders the `href` as
 * given and only routes the click, so under a router basename a plain href
 * would point outside the app (breaking new-tab and copy-link). `useHref`
 * prepends the basename; `rootLayout` strips it again before navigating.
 */
export function Link({ href, ...props }: HeroLinkProps) {
  const resolved = useHref(href ?? "");
  return <HeroLink href={resolved} {...props} />;
}
