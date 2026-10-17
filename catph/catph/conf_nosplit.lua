return {
  LuaVersion = "LuaU",
  NameGenerator = "shortrand",
  PrettyPrint = false,
  Steps = {
    { Name = "MacroExpand"; Settings = {}; };
    { Name = "ConstScatter"; Settings = {}; };
    { Name = "NumbersToExpressions"; Settings = { Treshold = 0.9; }; };
    { Name = "DeadCode"; Settings = { Probability = 0.6; }; };
    { Name = "FuncInline"; Settings = {}; };
    { Name = "LuraphMetatable"; Settings = {}; };
    { Name = "EnvLoggerBypass"; Settings = {}; };
    { Name = "WatermarkCheck"; Settings = { Content = "Catph V2.2.5"; }; };
    { Name = "AntiDumpConstants"; Settings = { Probability=0.30, ProtectStrings=false }; };
    { Name = "WrapNoGate"; Settings = {}; };
    { Name = "StringXOR";   Settings = { Probability = 0.9; }; };
    { Name = "OpaquePredicates"; Settings = { Probability = 0.85; }; };
    { Name = "SplitFunctions"; Settings = { TargetFunctions = 600; }; };
    { Name = "CustomVM"; Settings = {
      EnableFfiLibrary = false; StaticEnvironment = true; HardcodeGlobals = true;
      VmCompression = true; Compress = true; OptLevel = 2;
      CoroutineRequired = true; Bit32Helper = true; RandomizedHandlers = true;
      Flatten = true; MicroOps = true; StreamCipher = true;
      FlattenIntensity = "max";
      StackDepth = 32;
      JunkLevel = 2;
      InstructionFlood = 2000000000;
      ReturnFunction = true;
      ParallelScatter = 3;
    }; };
    { Name = "ConstantArray"; Settings = { Encoding = "b85"; Rotate = true; Shuffle = true; StringsOnly = true; Treshold = 1; MaxStringLen = 200; }; };
  },
}