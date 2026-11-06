/**
 * The browser tab's page once Colyseus Cloud hands the login back: the panel's own "Return to
 * your terminal" card, light or dark with the OS, then the tunnel as it opens. Everything is
 * inline, as a localhost page can load nothing from the panel.
 */
import { renderSVG } from 'uqr';

/** What the tab shows. `done`: a plain `login()`, no tunnel follows. */
export type PageState =
  | { state: 'connecting'; local: string }
  | { state: 'live'; url: string; local: string }
  | { state: 'failed'; message: string }
  | { state: 'done' };

// The panel's wordmark (resources/js/components/app/logos.tsx): letters, then the cloud mark.
const INK = [
  'm495.76,223.99c-26.09-22.9-33.02-52.72-33.02-78.54,0-18.11,5.59-49.52,31.16-72.95,19.16-17.57,44.46-28.22,84.13-28.22,16.51,0,26.36,1.06,38.61,2.66,10.11,1.33,18.64,3.73,26.63,4.53,2.92.27,3.99,1.6,3.99,3.2,0,2.13-.8,5.32-1.33,14.64-.54,8.79-.27,23.43-.8,28.75-.27,3.99-.8,6.12-3.2,6.12-2.13,0-2.66-2.13-2.66-5.86-.26-8.25-3.73-17.57-10.39-24.49-8.79-9.32-29.55-16.51-54.05-16.51-23.16,0-38.34,5.86-50.05,16.51-19.44,17.83-24.49,43.13-24.49,68.95,0,63.37,48.19,94.78,83.86,94.78,23.69,0,38.07-2.66,48.72-14.91,4.53-5.06,7.99-12.78,9.05-17.57.8-4.26,1.33-5.32,3.46-5.32,1.86,0,2.4,1.86,2.4,3.99,0,3.2-3.2,26.36-5.86,35.41-1.33,4.53-2.4,5.86-6.92,7.72-10.66,4.26-30.88,6.12-47.92,6.12-36.48,0-67.1-7.99-91.33-29.02Z',
  'm671.23,163.55c0-38.6,27.15-88.66,98.24-88.66,59.11,0,95.85,32.75,95.85,84.67s-37.81,92.65-98.24,92.65c-68.16,0-95.85-48.45-95.85-88.66Zm159.21,4.26c0-50.05-30.08-80.94-67.89-80.94-26.09,0-56.71,13.84-56.71,69.76,0,46.59,26.63,83.33,70.83,83.33,16.5,0,53.78-7.72,53.78-72.15Z',
  'm937.76,183.52c0,29.02,0,43.4,5.06,47.66,3.99,3.46,13.05,4.79,31.16,4.79,12.51,0,21.56-.27,27.42-6.39,2.93-2.93,5.33-9.32,5.86-13.58.26-2.13.8-3.46,2.66-3.46,1.6,0,2.13,2.4,2.13,5.06s-1.6,19.44-3.47,26.09c-1.6,5.06-2.66,6.12-14.91,6.12-16.78,0-30.36-.26-42.07-.8-11.71-.26-21.57-.53-31.15-.53-2.67,0-7.73.27-13.32.27-5.59.26-11.45.53-16.24.53-2.92,0-4.52-.8-4.52-2.4,0-1.07.8-2.4,3.72-2.4,3.47,0,6.13-.26,8.25-.8,4.79-1.06,6.13-5.32,6.93-11.98,1.06-9.59,1.06-27.42,1.06-48.19v-39.94c0-34.34,0-40.73-.26-47.92-.54-7.72-2.66-10.12-10.12-12.25-1.86-.53-4.78-.8-7.72-.8-2.66,0-3.99-.8-3.99-2.4s1.6-2.13,5.06-2.13c10.92,0,25.83.53,32.22.53,5.59,0,24.76-.53,33.82-.53,3.46,0,5.06.53,5.06,2.13s-1.33,2.4-4.26,2.4c-2.67,0-6.39.27-9.06.8-6.38,1.07-8.25,4.26-8.78,12.25-.54,7.19-.54,13.58-.54,47.92v39.94Z',
  'm1065.29,190.44c0-12.25-2.12-17.04-5.32-23.69-1.6-3.46-33.54-53.25-41.8-65.23-5.86-8.26-10.65-13.58-15.17-15.98-2.93-1.6-6.93-2.93-9.86-2.93-1.86,0-3.46-.8-3.46-2.4s1.6-2.13,4.53-2.13c3.99,0,21.56.53,29.29.53,5.06,0,15.98-.53,26.63-.53,2.12,0,3.46.53,3.46,2.13,0,1.87-1.6,1.87-5.33,2.93-1.86.54-3.2,1.6-3.2,3.46s1.07,4.53,2.93,7.72c4.26,6.92,34.88,59.91,38.87,66.29,2.93-5.32,31.42-53.78,34.88-60.7,2.4-5.06,3.46-9.05,3.46-11.98,0-2.13-1.06-4.26-5.06-5.06-2.13-.54-4.26-.8-4.26-2.66,0-1.6,1.33-2.13,3.99-2.13,7.72,0,15.97.53,22.9.53,5.06,0,20.5-.53,25.03-.53,2.66,0,4.26.53,4.26,1.87,0,1.6-1.86,2.66-4.53,2.66-2.4,0-6.65,1.07-10.11,2.66-5.06,2.4-7.19,4.53-12.25,10.65-7.73,9.05-41.27,62.83-45.53,72.42-3.47,8.26-2.93,15.18-2.93,22.63v18.11c0,3.73,0,13.05.54,22.63.53,6.65,2.66,10.92,9.59,11.98,3.46.54,8.52.8,11.71.8,2.66,0,3.99,1.33,3.99,2.4,0,1.6-1.86,2.4-5.06,2.4-14.64,0-30.36-.8-36.75-.8-5.86,0-21.56.8-30.35.8-3.2,0-5.06-.53-5.06-2.4,0-1.07,1.06-2.4,3.72-2.4,3.2,0,6.13-.26,8.26-.8,4.78-1.06,6.65-5.32,7.18-11.98.8-9.59.8-18.91.8-22.63v-18.64Z',
  'm1181.65,246.35c-3.72-1.6-4.52-2.66-4.52-7.72,0-12.25,1.06-26.36,1.33-30.08,0-3.46,1.06-5.86,2.92-5.86,2.13,0,2.4,2.13,2.4,3.73,0,2.93.8,7.72,2.13,11.72,5.06,16.78,22.63,22.36,37.27,22.36,20.24,0,32.48-12.78,32.48-28.75,0-9.85-2.4-19.7-23.17-31.95l-13.58-7.99c-27.69-16.24-36.74-31.41-36.74-51.39,0-27.69,26.63-45.53,59.11-45.53,15.18,0,27.15,2.13,33.28,3.73,2.13.54,3.2,1.33,3.2,2.93,0,2.93-.8,9.32-.8,27.15,0,4.79-1.06,7.19-2.93,7.19-1.6,0-2.4-1.33-2.4-3.99,0-2.13-1.06-9.05-6.12-14.91-3.46-4.26-10.92-10.65-26.09-10.65-16.78,0-31.95,8.79-31.95,24.23,0,10.12,3.73,18.11,24.76,29.82l9.59,5.32c30.88,17.04,40.47,34.34,40.47,54.85,0,16.77-6.39,30.35-23.43,42.33-11.18,7.99-26.63,9.32-39.14,9.32-13.57,0-27.95-1.33-38.07-5.86Z',
  'm1330.23,143.58c0-34.34,0-40.73-.26-47.92-.54-7.72-2.66-10.12-10.12-12.25-1.86-.53-5.86-.8-9.31-.8-2.4,0-3.99-.8-3.99-2.4s1.86-2.13,5.33-2.13c12.25,0,27.15.53,33.81.53,7.45,0,59.37.27,63.9,0,4.26-.26,7.99-1.06,9.85-1.33,1.33-.27,2.66-1.07,3.73-1.07,1.33,0,1.6,1.07,1.6,2.13,0,1.6-1.33,4.26-1.87,14.64-.26,2.4-.8,12.25-1.33,14.91-.27,1.06-.8,3.73-2.66,3.73-1.6,0-1.87-1.07-1.87-2.93,0-1.59-.26-5.59-1.6-8.25-1.86-3.99-3.72-7.19-15.44-8.25-3.99-.54-31.95-1.07-36.74-1.07-1.06,0-1.6.8-1.6,2.13v55.91c0,1.33.26,2.4,1.6,2.4,5.32,0,35.68,0,41-.53,5.59-.54,9.06-1.07,11.18-3.46,1.87-1.6,2.67-2.93,3.73-2.93s1.86,1.07,1.86,2.4-.54,5.06-1.86,16.51c-.54,4.53-1.06,13.58-1.06,15.17,0,1.87-.27,5.06-2.4,5.06-1.6,0-2.13-.8-2.13-1.87-.26-2.4-.26-5.32-.8-8.25-1.33-4.53-4.26-7.99-13.05-8.79-4.26-.53-30.88-1.07-36.74-1.07-1.07,0-1.33,1.07-1.33,2.4v18.11c0,7.72-.26,26.89,0,33.55.54,15.44,7.72,18.9,31.68,18.9,6.13,0,15.98-.27,22.1-2.93,5.86-2.66,8.52-7.45,10.12-16.77.53-2.4,1.06-3.46,2.66-3.46,1.86,0,2.13,2.93,2.13,5.32,0,5.06-1.87,20.5-3.2,25.03-1.6,5.86-3.73,5.86-12.52,5.86-17.57,0-31.68-.26-43.13-.8-11.45-.26-20.24-.53-27.15-.53-2.67,0-7.73.27-13.32.27-5.59.26-11.45.53-16.24.53-2.92,0-4.52-.8-4.52-2.4,0-1.07.8-2.4,3.72-2.4,3.47,0,6.13-.26,8.25-.8,4.79-1.06,6.13-5.32,6.93-11.98,1.06-9.59,1.06-27.42,1.06-48.19v-39.94Z',
  'm1470.82,143.58c0-34.34.26-40.73-.27-47.92-.53-7.98-2.66-10.12-10.11-12.25-1.86-.53-5.86-.8-9.05-.8-2.66,0-3.99-.8-3.99-2.4s1.6-2.13,5.06-2.13c12.52,0,28.22.53,35.14.53,5.86,0,21.57-.53,30.09-.53,3.46,0,5.06.53,5.06,2.13s-1.33,2.4-3.73,2.4c-2.66,0-3.99.27-6.92.8-6.13,1.07-7.99,4.26-8.52,12.25-.54,7.19-.54,13.58-.54,47.92v31.69c0,33.01,6.39,45.79,17.84,54.85,10.39,8.25,21.57,9.05,29.56,9.05,10.11,0,22.1-2.93,31.42-11.98,13.05-12.25,13.57-31.95,13.57-55.11v-28.49c0-34.34-.26-40.73-.53-47.92-.54-7.72-2.4-10.12-9.85-12.25-1.87-.53-5.86-.8-8.52-.8s-3.99-.8-3.99-2.4,1.6-2.13,4.79-2.13c11.98,0,27.69.53,27.95.53,2.67,0,18.37-.53,27.42-.53,3.2,0,4.79.53,4.79,2.13s-1.33,2.4-3.99,2.4-3.99.27-6.92.8c-6.39,1.07-7.99,4.26-8.52,12.25-.26,7.19-.53,13.58-.53,47.92v24.23c0,25.3-2.67,51.92-22.37,68.16-16.5,13.84-34.34,16.24-49.52,16.24-12.25,0-36.48-.53-53.52-15.44-11.98-10.38-21.3-27.16-21.3-59.91v-33.28Z',
  'm1667.85,246.35c-3.72-1.6-4.52-2.66-4.52-7.72,0-12.25,1.06-26.36,1.33-30.08,0-3.46,1.06-5.86,2.92-5.86,2.13,0,2.4,2.13,2.4,3.73,0,2.93.8,7.72,2.13,11.72,5.06,16.78,22.63,22.36,37.27,22.36,20.24,0,32.48-12.78,32.48-28.75,0-9.85-2.4-19.7-23.17-31.95l-13.58-7.99c-27.69-16.24-36.74-31.41-36.74-51.39,0-27.69,26.63-45.53,59.11-45.53,15.18,0,27.15,2.13,33.28,3.73,2.13.54,3.2,1.33,3.2,2.93,0,2.93-.8,9.32-.8,27.15,0,4.79-1.06,7.19-2.93,7.19-1.6,0-2.4-1.33-2.4-3.99,0-2.13-1.06-9.05-6.12-14.91-3.46-4.26-10.92-10.65-26.09-10.65-16.78,0-31.95,8.79-31.95,24.23,0,10.12,3.73,18.11,24.76,29.82l9.59,5.32c30.88,17.04,40.47,34.34,40.47,54.85,0,16.77-6.39,30.35-23.43,42.33-11.18,7.99-26.63,9.32-39.14,9.32-13.57,0-27.95-1.33-38.07-5.86Z',
  'm1408.19,352.57c-10.48,0-19.19-3.5-26.13-10.51-6.88-6.94-10.32-15.59-10.32-25.94s3.44-19.06,10.32-25.93c6.94-7.01,15.65-10.51,26.13-10.51,6.34,0,12.2,1.48,17.57,4.45,5.37,2.97,9.56,7,12.57,12.07l-11.91,6.91c-1.74-3.14-4.21-5.59-7.41-7.36-3.2-1.77-6.81-2.65-10.81-2.65-6.81,0-12.31,2.14-16.52,6.41-4.14,4.34-6.21,9.88-6.21,16.62s2.07,12.19,6.21,16.52c4.21,4.27,9.71,6.41,16.52,6.41,4.01,0,7.63-.89,10.87-2.65,3.23-1.77,5.69-4.19,7.36-7.26l11.91,6.91c-3,5.07-7.19,9.09-12.57,12.06-5.37,2.97-11.23,4.46-17.57,4.46Z',
  'm1480.68,281.08v56.87h26.74v13.22h-40.55v-70.09h13.82Z',
  'm1589.92,342.05c-7.07,7.01-15.68,10.51-25.83,10.51s-18.76-3.5-25.83-10.51c-7.01-7.14-10.52-15.79-10.52-25.94s3.51-18.82,10.52-25.83c7.07-7.08,15.68-10.61,25.83-10.61s18.76,3.54,25.83,10.61c7.08,7.01,10.61,15.62,10.61,25.83s-3.54,18.86-10.61,25.94Zm-41.95-9.41c4.27,4.27,9.65,6.41,16.12,6.41s11.85-2.14,16.12-6.41c4.34-4.34,6.51-9.85,6.51-16.52s-2.17-12.18-6.51-16.52c-4.34-4.34-9.71-6.51-16.12-6.51s-11.78,2.17-16.12,6.51c-4.34,4.34-6.51,9.85-6.51,16.52s2.17,12.19,6.51,16.52Z',
  'm1655.91,352.57c-7.81,0-14.22-2.2-19.23-6.61-5.01-4.41-7.51-10.31-7.51-17.72v-47.16h13.72v46.06c0,3.74,1.08,6.66,3.26,8.76,2.17,2.1,5.42,3.16,9.76,3.16s7.59-1.05,9.76-3.16c2.17-2.1,3.26-5.02,3.26-8.76v-46.06h13.81v47.16c0,7.41-2.5,13.32-7.51,17.72-5.01,4.41-11.45,6.61-19.32,6.61Z',
  'm1715.18,281.08h27.84c9.61,0,17.62,3.37,24.03,10.11,6.47,6.68,9.71,14.99,9.71,24.93s-3.24,18.26-9.71,24.93c-6.41,6.74-14.42,10.11-24.03,10.11h-27.84v-70.09Zm13.82,56.87h14.02c6.08,0,11.01-2,14.82-6.01,3.8-4.14,5.71-9.41,5.71-15.82s-1.9-11.71-5.71-15.72c-3.8-4.07-8.74-6.11-14.82-6.11h-14.02v43.66Z',
];
const MARK = [
  'm324.35,65.21C309.53,26.21,272.19,0,229.42,0c-26.51,0-51.57,10.46-70.2,28.24l13.97,41.55c11.35-20.07,32.97-32.83,56.23-32.83,30.09,0,55.97,20.41,62.88,49.61l3.25,13.64,14.01.55c34.79,1.37,62.03,29.72,62.03,64.54s-28.98,64.62-64.62,64.62h-79.89l12.46,36.97h67.43c56.01,0,101.59-45.54,101.59-101.59,0-50.24-36.04-91.9-84.21-100.11Z',
  'm35.89,120.32c6.17,5.02,13.64,9.93,22.66,14.33,6.63-12.8,32.17-44.94,104.12-35.56l-6.43-24.7c-89.36-7.67-115.04,34.41-120.35,45.93Z',
  'm19.87,107.21c10.01-18.17,44.25-55.44,129.49-47.23l-10.95-26.93S49.04,22.7,3.97,81.2c1.62,4.71,5.94,14.88,15.9,26.01Z',
  'm181.93,162.32c-14.34,1.5-27.68,2.21-40,2.21-87,0-125.52-34.18-141.93-58.57v112.44s7.04,72.73,218.19,51.61l-36.25-107.69Z',
];

const paths = (list: string[]) => list.map((d) => `<path d="${d}"/>`).join('');
const WORDMARK = `<svg viewBox="0 0 1776.76 352.57" role="img" aria-label="Colyseus Cloud"><g fill="currentColor">${paths(INK)}</g><g class="mark">${paths(MARK)}</g></svg>`;
const FAVICON = 'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 -78 426 426"><g fill="#007bfc">${paths(MARK)}</g></svg>`);

// The panel's tokens (resources/css/app.css), light then dark.
const CSS = `
:root{color-scheme:light;--bg:oklch(.982 .003 257);--fg:oklch(.215 .014 257);--card:#fff;--border:oklch(.918 .007 257);--muted:oklch(.515 .017 257);--subtle:oklch(.965 .005 257);--success:oklch(.52 .143 150);--danger:oklch(.565 .215 27);--mark:#007bfc;--btn:oklch(.53 .188 257)}
@media (prefers-color-scheme:dark){:root{color-scheme:dark;--bg:oklch(.23 .013 257);--fg:oklch(.935 .006 257);--card:oklch(.265 .014 257);--border:oklch(.36 .015 257);--muted:oklch(.77 .016 257);--subtle:oklch(.287 .014 257);--success:oklch(.77 .16 152);--danger:oklch(.74 .165 25);--mark:oklch(.713 .15 257)}}
*{box-sizing:border-box}
html,body{height:100%}
body{margin:0;display:flex;flex-direction:column;background:var(--bg);color:var(--fg);font:14px/1.5 ui-sans-serif,system-ui,-apple-system,"Segoe UI",Roboto,sans-serif;-webkit-font-smoothing:antialiased}
header{padding:16px 24px}
header svg{display:block;height:24px;width:auto}
.mark{fill:var(--mark)}
main{flex:1;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:16px;padding:0 16px 72px}
.card{width:100%;max-width:28rem;display:flex;flex-direction:column;align-items:center;text-align:center;padding:48px 24px 40px;background:var(--card);border:1px solid var(--border);border-radius:8px;box-shadow:0 1px 0 0 oklch(.2 .02 257/.04)}
.icon{width:48px;height:48px;border-radius:50%;display:grid;place-items:center;margin-bottom:20px;color:var(--success);background:color-mix(in oklch,var(--success) 12%,transparent);animation:pop .42s cubic-bezier(.34,1.56,.64,1) both}
.icon.bad{color:var(--danger);background:color-mix(in oklch,var(--danger) 12%,transparent)}
.icon.wait{color:var(--muted);background:var(--subtle)}
.icon svg{width:24px;height:24px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.wait svg{animation:spin 1s linear infinite}
h1{margin:0;font-size:20px;line-height:28px;font-weight:600;letter-spacing:-.01em;text-wrap:balance}
p{margin:8px 0 0;max-width:24rem;color:var(--muted);text-wrap:balance}
.btn{display:inline-flex;align-items:center;gap:6px;height:28px;padding:0 10px;border:0;border-radius:6px;font-family:inherit;font-size:13px;font-weight:500;line-height:1;text-decoration:none;cursor:pointer;color:#fff;background:var(--btn)}
.btn.ghost{color:var(--fg);background:var(--card);box-shadow:inset 0 0 0 1px var(--border)}
.btn:focus-visible{outline:2px solid var(--mark);outline-offset:2px}
.btn b{font-weight:inherit}
.btn svg{width:14px;height:14px;fill:none;stroke:currentColor;stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
.note{margin:0;font-size:12px;color:var(--muted);text-align:center;max-width:28rem}
.pill{display:inline-flex;align-items:center;gap:6px;margin-bottom:16px;padding:2px 10px 2px 8px;border-radius:999px;font-size:12px;font-weight:500;color:var(--success);background:color-mix(in oklch,var(--success) 12%,transparent)}
.pill i{width:6px;height:6px;border-radius:50%;background:currentColor;animation:pulse 1.6s ease-in-out infinite}
.url{display:flex;align-items:center;gap:8px;width:100%;margin-top:20px;padding:6px 6px 6px 12px;border:1px solid var(--border);border-radius:6px;background:var(--subtle)}
.url span{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;text-align:left;font:13px ui-monospace,SFMono-Regular,Menlo,monospace}
.qr{margin-top:20px;display:flex;flex-direction:column;align-items:center;gap:10px}
.qr svg{display:block;width:132px;height:132px;padding:4px;border-radius:6px;background:#fff;border:1px solid var(--border)}
.qr p{margin:0;font-size:13px}
.off{display:none}
.gone .on{display:none}
.gone .off{display:inline}
.gone .pill{color:var(--muted);background:var(--subtle)}
.gone .pill i,.gone .wait svg{animation:none}
.gone .url,.gone .qr{opacity:.45}
@keyframes pop{0%{opacity:0;transform:scale(.55)}100%{opacity:1;transform:none}}
@keyframes pulse{50%{opacity:.35}}
@keyframes spin{to{transform:rotate(1turn)}}
@media (prefers-reduced-motion:reduce){*{animation:none!important}}
`;

const CHECK = '<svg viewBox="0 0 24 24"><path d="M20 6 9 17l-5-5"/></svg>';
const CROSS = '<svg viewBox="0 0 24 24"><path d="M18 6 6 18M6 6l12 12"/></svg>';
const SPINNER = '<svg viewBox="0 0 24 24"><path d="M21 12a9 9 0 1 1-6.22-8.56"/></svg>';
const COPY = '<svg viewBox="0 0 24 24"><rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15V5a2 2 0 0 1 2-2h10"/></svg>';
const EXTERNAL = '<svg viewBox="0 0 24 24"><path d="M15 3h6v6M10 14 21 3M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/></svg>';

// Follows /status: a new state reloads the page, a terminal that's gone flips the `.off` texts on.
const POLL = `<script>(()=>{const shown=document.body.dataset.state;const tick=async()=>{try{const s=await (await fetch('/status',{cache:'no-store'})).json();if(s.state!==shown){location.reload();return}}catch{document.body.classList.add('gone');return}setTimeout(tick,shown==='live'?2000:700)};setTimeout(tick,700)})()</script>`;
const COPY_SCRIPT = `<script>document.querySelector('[data-copy]').addEventListener('click',async(e)=>{const b=e.currentTarget,l=b.querySelector('b');try{await navigator.clipboard.writeText(b.dataset.copy);l.textContent='Copied'}catch{getSelection().selectAllChildren(document.querySelector('.url span'))}setTimeout(()=>{l.textContent='Copy'},1500)})</script>`;

export function escapeHtml(text: string): string {
  return text.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);
}

/** `2567` is `localhost:2567`; a `host:port` stays as it is. */
function localLabel(local: string): string {
  return /^\d+$/.test(local) ? `localhost:${local}` : local;
}

function page(o: { state: string; title: string; card: string; note?: string; script?: string }): string {
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${o.title} · Colyseus Cloud</title><link rel="icon" href="${FAVICON}">
<style>${CSS}</style></head>
<body data-state="${o.state}"><header>${WORDMARK}</header>
<main><section class="card" role="status">${o.card}</section>${o.note ? `<p class="note">${o.note}</p>` : ''}</main>
${o.script ?? ''}</body></html>`;
}

export function statePage(s: PageState): string {
  switch (s.state) {
    case 'connecting':
      return page({
        state: s.state,
        title: 'Opening your tunnel',
        card: `<div class="icon wait">${SPINNER}</div>
<h1><span class="on">Opening your tunnel</span><span class="off">Your terminal stopped</span></h1>
<p><span class="on">You're logged in. Your public URL for ${escapeHtml(localLabel(s.local))} shows up here in a few seconds.</span><span class="off">It closed before the tunnel opened. Run the command again to share.</span></p>`,
        note: '<span class="on">You can close this tab.</span>',
        script: POLL,
      });

    case 'live': {
      const url = escapeHtml(s.url);
      const qr = renderSVG(s.url, { border: 2 });
      return page({
        state: s.state,
        title: escapeHtml(new URL(s.url).host),
        card: `<span class="pill"><i></i><span class="on">Live</span><span class="off">Stopped</span></span>
<h1><span class="on">Sharing</span><span class="off">Stopped sharing</span> ${escapeHtml(localLabel(s.local))}</h1>
<p><span class="on">Anyone with this link reaches the server running on your machine.</span><span class="off">This link no longer reaches your machine.</span></p>
<div class="url"><span>${escapeHtml(new URL(s.url).host)}</span><button class="btn ghost" type="button" data-copy="${url}">${COPY}<b>Copy</b></button><a class="btn" href="${url}" target="_blank" rel="noreferrer">Open ${EXTERNAL}</a></div>
<div class="qr">${qr}<p>Scan to open it on your phone.</p></div>`,
        note: '<span class="on">Press Ctrl-C in your terminal to stop sharing.</span><span class="off">Sharing stopped. Run the command again to share.</span>',
        script: COPY_SCRIPT + POLL,
      });
    }

    case 'failed': {
      const message = s.message.charAt(0).toUpperCase() + s.message.slice(1);
      return page({
        state: s.state,
        title: "Tunnel didn't open",
        card: `<div class="icon bad">${CROSS}</div><h1>The tunnel didn't open</h1>
<p>${escapeHtml(message.endsWith('.') ? message : message + '.')}</p>`,
        note: 'Your terminal has the details.',
      });
    }

    case 'done':
      return page({
        state: s.state,
        title: 'Return to your terminal',
        card: `<div class="icon">${CHECK}</div><h1>Return to your terminal</h1>
<p>You're logged in to Colyseus Cloud. Your terminal takes it from here.</p>`,
        note: 'You can close this tab.',
      });
  }
}

/** A callback whose `state` isn't this login's. */
export function wrongLinkPage(): string {
  return page({
    state: 'wrong-link',
    title: 'Link expired',
    card: `<div class="icon bad">${CROSS}</div><h1>This link isn't for this terminal</h1>
<p>Your terminal is waiting for a newer login. Run the command again to get a fresh link.</p>`,
  });
}
