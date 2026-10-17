// What Swift can see of the Objective-C++ side.
//
// ModEngineHost.h is deliberately plain Objective-C so this header stays
// importable: the C++ (modsynth::Processor, the message queue) lives entirely
// inside ModEngineHost.mm, where Swift never has to look at it.
#import "ModEngine/ModEngineHost.h"
