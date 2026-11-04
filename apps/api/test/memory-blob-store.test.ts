import { MemoryBlobStore } from "../src/platform/memory";
import { describeBlobStore } from "./blob-store";

describeBlobStore("memory", () => new MemoryBlobStore());
