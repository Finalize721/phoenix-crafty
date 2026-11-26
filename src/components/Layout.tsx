import type { RouteSectionProps } from "@solidjs/router";
import { m } from "../paraglide/messages";

export const Layout = (props: RouteSectionProps) => {
  return (
    <div class="min-h-dvh">
      {props.children}
      <footer class="fan-footer">
        {m.app_forkCredit()}{" "}
        <a href="https://github.com/firsttris/reactive-volcano-app">
          Reactive Volcano App
        </a>{" "}
        · AGPL-3.0
        <br />
        {m.app_unaffiliated()}
      </footer>
    </div>
  );
};
