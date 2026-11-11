/** Where the visitor's theme choice is kept (per browser). Absent = follow the system. */
export const THEME_KEY = 'sentinel-theme'

export type ThemeChoice = 'light' | 'dark' | 'system'

/**
 * Runs in <head> before the first paint so the page never flashes the wrong theme.
 * An explicit Light or Dark choice applies everywhere; without one, signed-in pages
 * (/admin…) are dark and public pages follow the system setting.
 */
export const THEME_BOOT_SCRIPT = `(function(){try{var d=document.documentElement,p=location.pathname,t=null;try{t=localStorage.getItem('${THEME_KEY}')}catch(e){}if(t==='light'||t==='dark'){d.setAttribute('data-theme',t)}else if(p==='/admin'||p.indexOf('/admin/')===0){d.setAttribute('data-theme','dark')}}catch(e){}})()`
