import { ThemeStudio } from "./ThemeStudio";
import type { RouteSectionProps } from "@solidjs/router";

export const Layout = (props: RouteSectionProps) => {
  return (
    <div class="min-h-dvh">
      <ThemeStudio />
      {props.children}
      <footer class="fan-footer">
        Independent fan project · Based on{" "}
        <a href="https://github.com/firsttris/reactive-volcano-app">
          Reactive Volcano App
        </a>{" "}
        · AGPL-3.0
        <br />
        Not affiliated with Capcom or Storz &amp; Bickel.
      </footer>
    </div>
  );
};
