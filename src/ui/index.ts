import { repairRememberedTicklerPaths } from "./host/company-path-memory";
import { ensureTicklerStyles } from "./styles";

ensureTicklerStyles();
// The bundle evaluates on every host page, so this clears entries left by
// earlier visits before any company switch can read them (GH#79).
repairRememberedTicklerPaths();

export { TicklerPage } from "./TicklerPage";
export { TicklerToolbarButton } from "./TicklerToolbarButton";
