-- Pandoc filter used for DOCX output, where --sandbox cannot be used (the DOCX writer needs its
-- bundled reference document). It removes every construct that could make Pandoc read a local file
-- or fetch a URL: images become their alt text, raw HTML/OpenXML is dropped.
function Image(el)
  local alt = pandoc.utils.stringify(el.caption)
  if alt == "" then return {} end
  return pandoc.Str(alt)
end
function RawInline() return {} end
function RawBlock() return {} end
