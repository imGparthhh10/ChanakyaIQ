/**
 * designSystem.js — Barrel export for the complete ChanakyaIQ
 * Design System.
 *
 * Import individual components:
 *   import { toast } from './components/toast.js';
 *
 * Or import everything:
 *   import * as DS from './designSystem.js';
 *   DS.toast.success('Done');
 */

export { toast }                                     from './components/toast.js';
export { modal }                                     from './components/modal.js';
export { Dropdown }                                  from './components/dropdown.js';
export { Accordion }                                 from './components/accordion.js';
export { Tooltip }                                   from './components/tooltip.js';
export { SearchBox }                                 from './components/searchBox.js';
export { DataTable }                                 from './components/table.js';
export { Pagination }                                from './components/pagination.js';
export { ProgressBar, CircularProgress }             from './components/progress.js';
export { Notification }                              from './components/notification.js';
export { Breadcrumb }                                from './components/breadcrumb.js';
export { createToggle, createCheckbox }              from './components/toggle.js';
export { createTag, createPill, PillGroup }          from './components/tags.js';
export { Spinner, DotsLoader, BarLoader, PulseLoader, SkeletonText } from './components/loader.js';
export { ThemeSwitcher }                             from './components/themeSwitcher.js';
export { Icon, iconNames }                           from './components/icons.js';
export { theme }                                     from './theme.js';
export { bus }                                       from './utils/eventBus.js';
export { h, qs, qsa, mount }                        from './utils/dom.js';
