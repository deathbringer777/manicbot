import meta from './meta.js';
import menu from './menu.js';
import general from './general.js';
import booking from './booking.js';
import screens from './screens.js';
import services from './services.js';
import master from './master.js';
import admin from './admin.js';
import support from './support.js';
import billing from './billing.js';
import sysadmin from './sysadmin.js';
import gcal from './gcal.js';

// Flat export for backward compatibility with t(lang, key)
export default {
  ...meta,
  ...menu,
  ...general,
  ...booking,
  ...screens,
  ...services,
  ...master,
  ...admin,
  ...support,
  ...billing,
  ...sysadmin,
  ...gcal,
};

// Named section exports for direct imports
export { meta, menu, general, booking, screens, services, master, admin, support, billing, sysadmin, gcal };
