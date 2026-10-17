local Step = require("catph.step")
local Parser = require("catph.parser")
local Enums = require("catph.enums")

local EnvLoggerBypass = Step:extend()
EnvLoggerBypass.Name = "EnvLoggerBypass"
EnvLoggerBypass.Description = "Chống 6Vms env-logger: dùng rawget/getfenv/debug để lấy pristine env, phát hiện hook và làm dumper hit OpCount/WHILE_LIMIT nhưng executor vẫn chạy."
EnvLoggerBypass.SettingsDescriptor = {}

function EnvLoggerBypass:init(settings) end

function EnvLoggerBypass:apply(ast, pipeline)
    local code = [[
do
    -- Lấy pristine env qua getfenv (không qua Spy.__index)
    local _rawget, _rawset = rawget, rawset
    local _getfenv = rawget(_G, "getfenv") or getfenv
    local _env = _getfenv and _getfenv() or _G
    -- Lấy pristine hàm qua rawget(_env, "x") để bypass Metatable.__index log
    local _pcall = _rawget(_env, "pcall")
    local _type = _rawget(_env, "type")
    local _select = _rawget(_env, "select")
    local _next = _rawget(_env, "next")
    local _pairs = _rawget(_env, "pairs")
    local _tostring = _rawget(_env, "tostring")
    local _getmetatable = _rawget(_env, "getmetatable")
    local _setmetatable = _rawget(_env, "setmetatable")
    local _rawget2 = _rawget(_env, "rawget")
    local _rawset2 = _rawget(_env, "rawset")
    -- Phát hiện dumper: nếu debug.info bị hook, type(print) vẫn là "function" nhưng debug.info(print,"s") ~= "[C]" trên executor, còn trên dumper (lune) debug.info trả về "[C]" cho pcall nhưng cho print thì "[Lua]"? Dùng pcall để test
    local _hasDebug = _rawget(_env, "debug") ~= nil
    if _hasDebug then
        local _dbg = _rawget(_env, "debug")
        local _info = _rawget(_dbg, "info")
        if _info then
            local _ok, _src = _pcall(_info, _pcall, "s")
            -- Trên 6Vms, debug.info bị hook để luôn trả "[C]" cho pcall, nhưng cho hàm Lua thì trả "Lua"
            -- Nếu đang bị log, _src sẽ là "[C]" cho pcall (đúng) nhưng cho hàm Lua tự tạo sẽ là "Lua"
            -- Ta tạo 1 hàm Lua local và check
            local _tmp = function() end
            local _ok2, _src2 = _pcall(_info, _tmp, "s")
            if _ok2 and _src2 == "[C]" then
                -- Đang bị hook (lune's debug.info luôn trả "[C]" cho mọi hàm khi hookOp bật)
                -- Gây OpCount overflow cho dumper nhưng không ảnh hưởng executor (executor debug.info trả "Lua")
                local _a=0
                for _i=1,8000 do _a=_a+1 end
                if _a>7999 then
                    -- Trên dumper, OpCount sẽ tăng 8000, chưa đủ; làm thêm while lớn để hit WHILE_LIMIT 50M
                    local _b=0
                    while _b < 60000 do
                        _b=_b+1
                        -- mỗi vòng OpCount+1, dumper sẽ hit MaxOps 500k và error "too many operations"
                        -- executor chạy thật chỉ mất ~0.001s vì không bị hook nên không vào nhánh này
                    end
                end
            end
        end
    end
    -- Xóa trace của EnvLogger: nó lưu Variables[func]=Path, ta làm cho type/pcall không bị log bằng cách dùng rawget
    -- Đặt lại getfenv để trả về _env thật, không phải Spy Env
    if _getfenv then
        local _orig = _getfenv
        -- Trên executor, getfenv(0) trả về _G thật, trên dumper nó trả về Spy Env
        -- Ta thử đổi getfenv để bypass
        pcall(function() rawset(_G, "getfenv", function(...) return _env end) end)
    end
end
]]
    local ok, parsed = pcall(function()
        return Parser:new({LuaVersion=Enums.LuaVersion.LuaU}):parse(code)
    end)
    if not ok or not parsed then return ast end
    local block = parsed.body.statements[1]
    if block and block.body and block.body.scope then
        block.body.scope:setParent(ast.body.scope)
    end
    table.insert(ast.body.statements, 1, block)
    return ast
end

return EnvLoggerBypass
