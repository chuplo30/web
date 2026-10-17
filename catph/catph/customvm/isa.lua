



local ISA = {}
-- opcode step catph nigger
ISA.MULTRET = -1 

ISA.OP = {
    
    LOADNIL    = 2,
    LOADB      = 3,   
    LOADN      = 4,   
    LOADK      = 5,   
    MOVE       = 6,   
    
    GETGLOBAL  = 7,   
    SETGLOBAL  = 8,   
    
    GETUPVAL   = 9,
    SETUPVAL   = 10,
    CLOSEUPVALS= 11,
    
    GETTABLE   = 13,  
    SETTABLE   = 14,  
    GETTABLEKS = 15,  
    SETTABLEKS = 16,  
    GETTABLEN  = 17,  
    SETTABLEN  = 18,  
    
    NEWCLOSURE = 19,
    NAMECALL   = 20,
    CALL       = 21,  
    RETURN     = 22,  
    
    JUMP       = 23,
    JUMPBACK   = 24,
    JUMPIF     = 25,
    JUMPIFNOT  = 26,
    JUMPIFEQ   = 27,
    JUMPIFLE   = 28,
    JUMPIFLT   = 29,
    JUMPIFNOTEQ= 30,
    JUMPIFNOTLE= 31,
    JUMPIFNOTLT= 32,
    
    ADD        = 33,  
    SUB        = 34,
    MUL        = 35,
    DIV        = 36,
    MOD        = 37,
    POW        = 38,
    IDIV       = 81,
    
    ADDMOVE    = 82,  
    MOVE_ADD   = 83,  
    GETTKS_MOVE= 84,  
    LOADK_MOVE = 85,  
    
    CONCAT     = 49,  
    NOT        = 50,  
    MINUS      = 51,  
    LENGTH     = 52,  
    
    NEWTABLE   = 53,  
    SETLIST    = 55,  
    FORNPREP   = 56,
    FORNLOOP   = 57,
    FORGLOOP   = 58,
    
    GETVARARGS = 63,
    -- Catph opcode extension: aliases (same semantics, new numbers),
    -- fused super-ops and literal variants. Total ISA = 125 opcodes.
    -- Aliases: arithmetic X (88-94)
    ADDX       = 88,
    SUBX       = 89,
    MULX       = 90,
    DIVX       = 91,
    MODX       = 92,
    POWX       = 93,
    IDIVX      = 94,
    -- Aliases: moves/loads (95-102)
    MOVE2      = 95,
    MOVE3      = 96,
    MOVE4      = 97,
    LOADK2     = 98,
    LOADK3     = 99,
    LOADN2     = 100,
    LOADB2     = 101,
    LOADNIL2   = 102,
    -- Aliases: tables (103-111)
    GETTABLE2  = 103,
    GETTABLE3  = 104,
    SETTABLE2  = 105,
    GETTABLEKS2= 106,
    SETTABLEKS2= 107,
    GETTABLEN2 = 108,
    SETTABLEN2 = 109,
    NEWTABLE2  = 110,
    SETLIST2   = 111,
    -- Aliases: calls (112-119)
    CALL2      = 112,
    CALL3      = 113,
    CALL4      = 114,
    RETURN2    = 115,
    NAMECALL2  = 116,
    NAMECALL3  = 117,
    NEWCLOSURE2= 118,
    GETVARARGS2= 119,
    -- Aliases: globals/upvals (120-127)
    GETGLOBAL2 = 120,
    GETGLOBAL3 = 121,
    GETGLOBAL4 = 122,
    SETGLOBAL2 = 123,
    SETGLOBAL3 = 124,
    GETUPVAL2  = 125,
    SETUPVAL2  = 126,
    CLOSEUPVALS2= 127,
    -- Aliases: misc unary (128-131)
    CONCAT2    = 128,
    NOT2       = 129,
    MINUS2     = 130,
    LENGTH2    = 131,
    -- Literal variants, emitted conditionally by aliasPass (132-137)
    LOADT      = 132,
    LOADF      = 133,
    LOAD0      = 134,
    LOAD1      = 135,
    RETURN0    = 136,
    RETURN1    = 137,
    -- Fused super-ops, produced by SUPER_OPS peephole (39-48,54,59,61,62,65-72,76,77)
    MOVEMOVE   = 39,
    LOADN_MOVE = 40,
    LOADB_MOVE = 41,
    LOADNIL_MOVE= 42,
    GETGLOB_MOVE= 43,
    GETGLOB_CALL= 44,
    LOADK_CALL = 45,
    CALL_MOVE  = 46,
    MOVE_CALL  = 47,
    GETTAB_MOVE= 48,
    GETTABLEN_MOVE= 54,
    NOT_MOVE   = 59,
    MINUS_MOVE = 61,
    LENGTH_MOVE= 62,
    CONCAT_MOVE= 65,
    SUB_MOVE   = 66,
    MUL_MOVE   = 67,
    DIV_MOVE   = 68,
    MOD_MOVE   = 69,
    POW_MOVE   = 70,
    IDIV_MOVE  = 71,
    MOVE_SETGLOB= 72,
    GETUV_MOVE = 76,
    MOVE_SETUPV= 77,
}


ISA.NAME = {}
for name, num in pairs(ISA.OP) do
    ISA.NAME[num] = name
end

return ISA
-- cặc ba t