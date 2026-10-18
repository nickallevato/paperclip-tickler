import { Eye } from "lucide-react";
import type { Company } from "@paperclipai/shared";
import { CompanyPatternIcon } from "../host/ui-kit";

const MICRO = "text-[length:var(--tickler-fs-micro,11px)] leading-[1.45]";
const BODY = "text-[length:var(--tickler-fs-body,14px)] leading-[1.45]";

/**
 * The orgs you hid from Tickler, each with a way back (PLI-310). Lives in the
 * gear's panel with the other per-browser settings; the header's "N hidden"
 * opens it. Only active orgs are listed: archived and paused ones are left out
 * by their Paperclip status, and showing one here would bring nothing back.
 */
export function TicklerHiddenOrgs({
  companies,
  onShow,
}: {
  companies: Company[];
  onShow: (companyId: string) => void;
}) {
  return (
    <div data-hidden-orgs className="space-y-2 rounded-lg border bg-card p-3">
      <div className="flex flex-wrap items-baseline gap-2">
        <span className={`${BODY} font-semibold`}>Hidden orgs</span>
        <span className={`${MICRO} text-muted-foreground`}>
          Tickler does not load these. They keep running in Paperclip. Saved in this browser only.
        </span>
      </div>
      <ul className="flex flex-wrap gap-2">
        {companies.map((company) => (
          <li key={company.id} className="flex items-center gap-1.5 rounded-md border py-0.5 pl-1.5 pr-0.5">
            <CompanyPatternIcon
              companyName={company.name}
              logoUrl={company.logoUrl}
              className="size-4 shrink-0 rounded text-(length:--text-nano)"
            />
            <span className={BODY}>{company.name}</span>
            <button
              type="button"
              onClick={() => onShow(company.id)}
              aria-label={`Show ${company.name} in Tickler`}
              className={`${MICRO} inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-muted-foreground hover:bg-muted hover:text-foreground`}
            >
              <Eye className="h-3 w-3" /> Show
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}
