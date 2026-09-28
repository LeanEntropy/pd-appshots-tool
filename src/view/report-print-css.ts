/**
 * The one print stylesheet (plan 6.4), shared by the exported PDF, the browser's own "Print or
 * save as PDF" on the report page, and later the "Report only" share page. Light colours are
 * forced and kept (backgrounds print); every numbered section starts on a new page; cards,
 * table rows and pictures are not split across pages; long tables repeat their header row.
 */
export const PRINT_CSS = `
@media print {
  @page { size: A4 landscape; margin: 10mm; }
  /* Light colours on paper, also when the screen is dark (the id beats the dark-mode rule). */
  :root:not(#print-light), :root[data-theme="dark"] { --bg: #ffffff; --card: #ffffff; --text: #1d1d1f; --muted: #5f5f66; --line: #d4d4d2; --accent: #2f6fdb; --warn: #b3261e; --next: #c2410c; --tint: #eef3fd; --accent-2: #0f766e; --head-bg: #e6f4f1; --ok: #15803d; --mid: #b45309; --bad: #b91c1c; --brand: #4338ca; --brand-2: #0f766e; }
  * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
  body { background: #fff; font-size: 12px; }
  #runbar, .appbar, ol.steps, header.top, .noprint, #infoPop, dialog, #act-toasts, #expansion { display: none !important; }
  main.pages { padding: 0; max-width: none; }
  button.imgbtn, button.info, #reportApprove, .banner button { display: none !important; }
  button.linkbtn { color: var(--accent); }
  details > summary { list-style: none; } details > summary::-webkit-details-marker { display: none; }
  details.sec { break-before: page; border-radius: 6px; }
  details.sec > summary h2 { font: inherit; margin: 0; }
  h2, h3, h4, h5, details > summary { break-after: avoid; }
  .tablewrap { overflow: visible; }
  table.rt { width: 100%; font-size: 11px; }
  thead { display: table-header-group; }
  tr, .slot dl, .card, .verdict, .banner, .pcard, figure, .rthumb, .rimgs, ol.keypoints li, .contbox, .freebox { break-inside: avoid; }
  table.rt.pos td { min-width: 0; }
  table.rt.pos .rthumb img { height: 110px; max-width: 100%; object-fit: contain; }
  .rthumb img { max-width: 100%; }
  .slot { break-inside: avoid; }
  .strip > .rimgs { display: inline-flex; flex-direction: column; gap: 2px; max-width: 220px; }
  .pinfo { display: block; font-size: 10px; color: var(--muted); }
  .lbl .pinfo { display: none; }
  .toc a { color: var(--accent); font-weight: 600; }
  .titlepage { break-after: page; padding: 40mm 10mm 0; }
  .titlepage h1 { font-size: 30px; margin: 0 0 6px; color: var(--accent-2); }
  .titlepage .kind { font-size: 16px; font-weight: 700; color: var(--brand); text-transform: uppercase; letter-spacing: .06em; }
  .titlepage dl { display: grid; grid-template-columns: max-content 1fr; gap: 6px 16px; font-size: 14px; margin-top: 18px; }
  .titlepage dt { color: var(--muted); }
  .titlepage dd { margin: 0; }
}
`;
