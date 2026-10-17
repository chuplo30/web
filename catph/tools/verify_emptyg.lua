-- tools/verify_emptyg.lua : simulate executor with empty _G (reads via _G -> nil,
-- real env otherwise intact). Must run AFTER verify_prelude.lua, BEFORE target.
_G = {}
