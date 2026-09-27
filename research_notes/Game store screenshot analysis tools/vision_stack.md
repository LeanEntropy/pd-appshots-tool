# Vision/AI Component Stack for Mobile Game Store Screenshot Analysis

## Verify: QwenLM/Qwen3-VL (sizes, license, grounding/bbox output)

### Takeaway
Qwen3-VL exists, is actively maintained, is Apache-2.0 licensed, ships in 2B/4B/8B/32B dense sizes plus 30B-A3B and 235B-A22B MoE variants, and natively supports 2D bounding-box and point grounding plus experimental 3D grounding — the prior report's claims here check out.

### Cited Findings
- QwenLM/Qwen3-VL is a real, actively documented repo from the Qwen team at Alibaba Cloud — [GitHub - QwenLM/Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)
- Model sizes: 2B, 4B, 8B, 32B (Instruct and Thinking editions, some with FP8 quantized versions), plus MoE variants 30B-A3B (3B active) and 235B-A22B (22B active) — [GitHub - QwenLM/Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)
- License is Apache-2.0 per the repository — [GitHub - QwenLM/Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)
- Grounding: "Precise Object Grounding Across Formats" supports both boxes and points; bounding boxes are output relative to a normalized 1000x1000 coordinate space; the model also supports 3D grounding (position, size, depth) — [GitHub - QwenLM/Qwen3-VL](https://github.com/QwenLM/Qwen3-VL); [debuggercafe.com introduction](https://debuggercafe.com/introduction-to-qwen3-vl/)
- Most recent documented update: technical paper released November 27, 2025; original series launched October 2024 — [GitHub - QwenLM/Qwen3-VL](https://github.com/QwenLM/Qwen3-VL)
- Community tooling exists to combine Qwen3-VL grounding output with SAM2 for segmentation ("Grounding Qwen3-VL Detection with SAM2") — [debuggercafe.com](https://debuggercafe.com/grounding-qwen3-vl-detection-with-sam2/)
- A known accuracy issue: Qwen3-VL can produce incorrect bounding boxes on non-square/non-1000x1000px images, an open llama.cpp issue — [GitHub issue #16880](https://github.com/ggml-org/llama.cpp/issues/16880)

### Inferences
- Qwen3-VL's bbox output convention (normalized 0–1000 space) means any pipeline consuming its grounding output must know the original image's aspect ratio to de-normalize correctly — the reported llama.cpp bug suggests some inference backends mishandle this for non-square screenshots (game store screenshots are typically non-square, e.g. 9:16 or 16:9), which is a real integration risk to flag.
- The Apache-2.0 license and range of sizes make Qwen3-VL genuinely viable for self-hosting, but the smaller sizes (2B/4B) are likely needed for affordable local/consumer-GPU inference; larger sizes (32B+) would need real GPU hosting cost, undercutting "cheap self-host" claims for a solo dev with a modest budget.

### Gaps
- No direct verification of Qwen3-VL's real-world accuracy specifically on marketing overlay text or character-art bounding boxes (as opposed to general grounding benchmarks) — not covered in available sources.
- Could not confirm from primary sources whether Qwen3-VL has had any post-November-2025 releases specifically as of September 2026; the GitHub fetch only surfaced the November 27, 2025 paper as most recent.

## Verify: PaddleOCR (PP-OCRv5, stylized/game-font accuracy, license)

### Takeaway
PaddleOCR and PP-OCRv5 are real, actively developed, Apache-2.0 licensed; PP-OCRv5 is a genuine accuracy improvement over PP-OCRv3/v4 for general and multilingual text, but on stylized/game-font text specifically it lags well behind newer end-to-end VLM-OCR models — a third-party benchmark puts PaddleOCR at only ~52% accuracy on a "Game" screenshot text category versus ~71% for a competing VLM-based OCR (HunyuanOCR).

### Cited Findings
- PaddleOCR 3.0 is an Apache-2.0 licensed open-source OCR/document-parsing toolkit; PP-OCRv5 is one of its three major solutions (alongside PP-StructureV3 and PP-ChatOCRv4) — [GitHub - PaddlePaddle/PaddleOCR](https://github.com/PaddlePaddle/PaddleOCR); [PaddleOCR 3.0 Technical Report](https://arxiv.org/html/2507.05595v1)
- PP-OCRv5 delivers roughly a 13% accuracy boost over prior versions, and >30% improvement in multilingual recognition versus PP-OCRv3, per Baidu/PaddlePaddle's own blog — [Hugging Face blog: PP-OCRv5](https://huggingface.co/blog/baidu/ppocrv5)
- On a proprietary 900-image, 10-category text-spotting benchmark, Tencent's HunyuanOCR technical report (Table 3) scored PaddleOCR at 51.59% on the "Game" screenshot category versus 70.92% for HunyuanOCR itself; overall PaddleOCR scored 53.38% vs. HunyuanOCR's 70.92% — [HunyuanOCR Technical Report, arXiv:2511.19575](https://arxiv.org/pdf/2511.19575)
- General note: PaddleOCR "fails in several cases, mostly when there are different angles of rotated text, some alternative fonts and differing colour/contrast" and "can misrecognize stylized fonts or low-contrast text" — [source article, unnamed benchmark discussion found via search; treat as secondary/lower-confidence]
- One source claims PaddleOCR reaches a low error rate of 0.165 specifically on "Art Font" recognition in a separate, unspecified benchmark — [secondary source, could not identify the underlying paper directly; low confidence]
- Latest PaddleOCR-VL work (0.9B ultra-compact VLM for document parsing) is a distinct, newer line (PaddleOCR-VL, PaddleOCR-VL-1.5, PaddleOCR-VL-1.6) from the same team, released Oct 2025–Jun 2026 — [arXiv:2510.14528](https://arxiv.org/pdf/2510.14528); [arXiv:2601.21957](https://arxiv.org/pdf/2601.21957); [arXiv:2606.03264](https://arxiv.org/pdf/2606.03264)

### Inferences
- The prior ChatGPT report's claim that PaddleOCR/PP-OCRv5 is current, active, and Apache-2.0 is correct, but its likely implicit claim that PaddleOCR is a strong choice for stylized game-marketing text should be treated skeptically — the HunyuanOCR benchmark (a competing vendor's paper, so read with some bias caveat) shows a roughly 20-point accuracy gap on exactly the "Game" screenshot category versus a modern end-to-end OCR VLM.
- For this task's stylized marketing captions (often decorative fonts, gradients, outlines, drop shadows), a general-purpose OCR pipeline like PaddleOCR is a reasonable free/self-hosted first pass, but accuracy on the most decorative promotional text likely needs to be checked/backstopped by a frontier VLM (Claude/Gemini/GPT) doing a second read-and-correct pass.

### Gaps
- Could not independently verify the HunyuanOCR benchmark numbers against a neutral third-party source — this is a single competing-vendor paper; no corroborating benchmark from an independent group was found.
- Could not verify the specific "0.165 Art Font error rate" claim's source paper/methodology; flagging as unverified.
- No direct evidence found on PaddleOCR's performance on actual mobile game App Store screenshot marketing overlays specifically (as opposed to general "Game" category text, which may mean in-game HUD text rather than marketing caption text).

## Verify: IDEA-Research/Grounded-SAM-2

### Takeaway
Grounded-SAM-2 is a real, currently maintained IDEA-Research project combining Grounding DINO, Florence-2, and SAM 2 for open-vocabulary detection/segmentation/tracking, licensed Apache-2.0 for its own code (with separate license files for bundled third-party components).

### Cited Findings
- Repo description: "Grounded SAM 2: Ground and Track Anything in Videos with Grounding DINO, Florence-2 and SAM 2" — [GitHub - IDEA-Research/Grounded-SAM-2](https://github.com/IDEA-Research/Grounded-SAM-2)
- Main license is Apache License 2.0; separate `LICENSE_groundingdino` and `LICENSE_cctorch` files exist for bundled components (cc_torch is an optional post-processing step for mask predictions) — [LICENSE file](https://github.com/IDEA-Research/Grounded-SAM-2/blob/main/LICENSE); [LICENSE_groundingdino](https://github.com/IDEA-Research/Grounded-SAM-2/blob/main/LICENSE_groundingdino); [LICENSE_cctorch](https://github.com/IDEA-Research/Grounded-SAM-2/blob/main/LICENSE_cctorch)
- The repo is indexed/documented on Context7, suggesting active usage/documentation — [Context7 page](https://context7.com/idea-research/grounded-sam-2)
- The earlier "Grounded-Segment-Anything" (SAM v1-based) predecessor project also exists separately and is also Apache-2.0 — [GitHub - IDEA-Research/Grounded-Segment-Anything](https://github.com/idea-research/grounded-segment-anything)

### Inferences
- For this task, Grounded-SAM-2 is a viable open-source path to get pixel-accurate masks (not just boxes) for character art or UI elements by supplying text prompts (e.g., "character," "banner," "logo") to Grounding DINO and passing detections to SAM 2 for segmentation — useful specifically for isolating character art bounding boxes/masks from marketing background art.

### Gaps
- Could not confirm exact latest release/commit date or whether the project has had a 2026-specific update (search results did not surface a dated changelog); activity level beyond "documented on Context7" is not strongly verified.

## Verify: microsoft/OmniParser (July 2026 update?)

### Takeaway
Confirmed: microsoft/OmniParser did receive a July 2026 update adding a YOLOv9-E interactive region detector (PRs merged July 18 and July 20, 2026); the project remains actively maintained under a mixed licensing scheme (MIT for core/newer detector and caption models, but AGPL for some older Ultralytics-based icon detector components).

### Cited Findings
- Direct GitHub commit history confirms: July 18, 2026 commit "feat(detector): add Hugging Face-backed YOLOv9-E inference" (by adamlu123/Copilot), and July 20, 2026 merge of PR implementing YOLOv9-E detector functionality (by ahmed-awadallah) — [github.com/microsoft/OmniParser commits](https://github.com/microsoft/OmniParser/commits/master)
- The YOLOv9-E inference-only weight is published to Hugging Face via PR #37 — [huggingface.co/microsoft/OmniParser](https://huggingface.co/microsoft/OmniParser/commit/7f4732c12e58f7dab3e06f9ec63b021f689317d5) (corroborating search summary; not independently opened)
- Licensing: OmniParser v2's icon_detect_v3 is based on MIT-licensed YOLOv9; caption models are MIT-licensed; but earlier Ultralytics-based icon detectors retain their original AGPL license — [search-sourced summary, multiple corroborating hits, no single primary LICENSE file fetched directly]
- OmniParser v2.0.1 (current as of April 2026) includes a CVE-2025-55322 security patch — [search-sourced, not independently verified against a CVE database]
- OmniParser is a "simple screen parsing tool towards pure vision based GUI agent," and in 2026 is commonly paired with hosted VLMs (Claude Sonnet 4.6, Claude Opus 4.7, GPT-5-class endpoints, or Qwen3-VL) as the "eyes" for GUI-agent action grounding — [microsoft.github.io/OmniParser](https://microsoft.github.io/OmniParser/)

### Inferences
- OmniParser's core purpose (GUI element/icon detection for automating clicks in software UIs) is a different problem from decomposing marketing screenshots — it's built to find clickable icons/text regions in a live app UI, not to distinguish "game capture region" vs. "marketing overlay art" vs. "character art" in a promotional screenshot. It's a plausible building block for detecting UI chrome and buttons in a raw game screenshot, but is not purpose-built for the marketing-decomposition task and its use here would be a repurposing, not a direct fit.
- The mixed AGPL/MIT licensing on legacy detector components means any production/commercial pipeline built on OmniParser should specifically pin to the MIT-licensed YOLOv9-E-based detector path rather than any leftover Ultralytics/AGPL icon detector, to avoid copyleft obligations.

### Gaps
- Could not independently open/verify the actual LICENSE file text on GitHub in this session — license characterization is based on secondary search summaries, not a direct primary-source read.
- Could not verify GitHub star count or issue/PR velocity to independently assess "how actively maintained" beyond the confirmed July 2026 commits.

## Hosted frontier VLMs (Claude, Gemini, GPT) — structured JSON, bbox/grounding, cost per image; hosted vs. self-hosting Qwen for a solo dev

### Takeaway
All three major hosted frontier VLM families support structured/JSON-schema output as of September 2026; only Gemini has a documented, first-class native bounding-box/grounding output convention (normalized 0–1000 `[y_min,x_min,y_max,x_max]`) — Claude and GPT can be prompted to emit coordinates but this is not a dedicated grounding feature with the same native support. For a solo developer processing "hundreds of images," a hosted API is very likely simpler and cheaper in total effort than self-hosting Qwen3-VL, given token-based image pricing on the order of cents per image versus needing to provision and maintain GPU infrastructure.

### Cited Findings
- Gemini natively detects and localizes objects with bounding boxes in the format `[y_min, x_min, y_max, x_max]`, normalized 0–1000, and box generation is customizable via natural-language instructions (e.g., "bounding boxes of all green objects") without training a custom model — [Google Cloud Gemini Enterprise Agent Platform docs](https://docs.cloud.google.com/gemini-enterprise-agent-platform/models/bounding-box-detection); [Google Skills repo reference](https://github.com/google/skills/blob/main/skills/cloud/gemini-api/references/bounding_box.md); [Roboflow blog on Gemini 2.5 object detection/segmentation](https://blog.roboflow.com/gemini-2-5-object-detection-segmentation/)
- Gemini 2.5 also supports zero-shot segmentation (masks), not just boxes — [blog.roboflow.com](https://blog.roboflow.com/gemini-2-5-object-detection-segmentation/)
- Claude Platform Docs has a dedicated "Structured outputs" page confirming JSON-schema-constrained output is a supported first-class feature — [platform.claude.com/docs Structured outputs](https://platform.claude.com/docs/en/build-with-claude/structured-outputs)
- Claude vision pricing is token-based from image dimensions (~ width×height/750 tokens); a 4-image call costs ~4x a 1-image call; output tokens are priced at 5x input, so structured/concise JSON output helps control cost — [Developers Digest Claude Vision API guide](https://www.developersdigest.tech/blog/claude-vision-api-production-guide); [Claude Platform Docs pricing](https://platform.claude.com/docs/en/about-claude/pricing)
- Current (Sept 2026) Claude model pricing: Opus 4.8 $5/$25 per MTok (in/out), Sonnet 4.6 $3/$15, Haiku 4.5 $1/$5; prompt caching cuts cached input cost 90%; batch processing is 50% cheaper — [finout.io Anthropic pricing 2026](https://www.finout.io/blog/anthropic-api-pricing)
- GPT-5 Image (vision-capable) pricing: $10/million input tokens, $40/million output tokens — a 4x premium over base GPT-5 text pricing ($1.25/$10 per MTok); GPT-5 Image supports structured outputs via JSON schema in `response_format` — [OpenRouter GPT-5-Image pricing](https://openrouter.ai/openai/gpt-5-image)
- Gemini 2.5 Pro token pricing: $1.25/million input tokens and $10/million output tokens for prompts ≤200K tokens (rising to $2.50/$15 above 200K); an output image (≤1024x1024) consumes ~1290 tokens ≈ $0.039/image (this is image-generation cost, not confirmed to be the vision-input analysis cost) — [Curlscape/aifreeapi/multiple Sept 2026 pricing roundups]

### Inferences
- Because Gemini has the most mature, documented native bbox/segmentation grounding output, it is the strongest hosted-API candidate specifically for the bounding-box/segmentation sub-tasks in this project (character art bbox, banner bbox); Claude and GPT are strong candidates for the classification, structured-JSON-schema decomposition, and caption-text-transcription sub-tasks, but would need to be prompted carefully (and likely verified) for precise pixel coordinates since bbox grounding is not their documented specialty.
- For "hundreds of images," per-image hosted VLM cost is very likely in the sub-cent-to-few-cents range per image (a single screenshot is a modest number of image tokens, well under a million-token budgeCoolstruct output response is also small) — this makes total cost for a few hundred images almost certainly under $10–$50 depending on model tier, which is very likely far cheaper in total time/effort than provisioning a GPU (local or cloud) to self-host Qwen3-VL, especially since a solo dev pipeline that runs occasionally doesn't justify a persistent GPU rental. This is an inference based on the pricing figures above, not a confirmed head-to-head benchmark found in sources — no source directly computed "$ per screenshot" for this exact task.
- A hybrid approach — Gemini for bbox/grounding of banners/character-art/device-frame regions, plus Claude or GPT for classification + structured JSON schema decomposition + caption transcription (cross-checked against a deterministic OCR pass) — is plausible as a best-fit architecture, since no single hosted model source claims best-in-class at all three (grounding, structured output, transcription accuracy on stylized text).

### Gaps
- No source gave an exact, task-specific "cost per screenshot analyzed end-to-end" figure for any of the three frontier hosted APIs; the per-image cost estimates above are derived/inferred from general token pricing, not a verified benchmark of this specific decomposition task.
- Could not confirm current (Sept 2026) exact model names/versions in production for "Claude" and "GPT" beyond what pricing-roundup sites listed (Opus 4.8, Sonnet 4.6, Haiku 4.5, GPT-5/GPT-5 Image) — these should be treated as sourced from third-party pricing aggregators, not confirmed against Anthropic's/OpenAI's own docs pages directly in this session.
- No direct evidence comparing hosted-VLM caption-text transcription accuracy against PaddleOCR/HunyuanOCR on the same stylized-game-marketing-text benchmark — this would need dedicated testing.

## Alternatives: Florence-2, Moondream, Molmo, Grounding DINO 1.5/DINO-X, Surya OCR, EasyOCR, docTR, Google Cloud Vision OCR, layout detection

### Takeaway
All named alternatives are real and current as of Sept 2026. Florence-2 (MIT) and Molmo 2 (Apache-2.0, with a caveat on some training-data non-commercial restrictions) are the most permissively licensed open options; Moondream uses a custom, more restrictive "Moondream License"; Grounding DINO 1.5 and DINO-X (IDEA-Research) are both Apache-2.0 and purpose-built for high-accuracy open-vocabulary detection; Surya OCR's code is Apache-2.0 but its model weights use a modified OpenRAIL-M license requiring a paid license above a revenue/funding threshold; docTR is a solid self-hosted OCR alternative comparable to cloud OCR on document-style text; Google Cloud Vision OCR is a mature managed-service option.

### Cited Findings
- Florence-2 is Microsoft's lightweight vision-language model, open-sourced under the MIT license — [Roboflow model-licenses page](https://roboflow.com/model-licenses/florence-2); [Roboflow Florence-2 blog](https://blog.roboflow.com/florence-2/)
- Moondream is released under a custom "Moondream License" (not a standard OSI license) — [Slashdot Florence-2 vs Moondream comparison](https://slashdot.org/software/comparison/Florence-2-vs-Moondream/); Moondream 3.1 9B-A2B model card exists — [moondream.ai model card](https://moondream.ai/models/moondream_3-1_9B_A2B)
- Molmo 2 (Allen Institute for AI / Ai2) released Dec 2025 with weights, training data, and training code, licensed Apache 2.0; however some third-party datasets used in training are restricted to academic/non-commercial research use, so downstream commercial use should be reviewed carefully — [Ai2 Molmo 2 blog](https://allenai.org/blog/molmo2); [Hugging Face allenai/Molmo2-8B](https://huggingface.co/allenai/Molmo2-8B)
- Grounding DINO 1.5 (Pro/Edge variants) and DINO-X are both from IDEA-Research and both released under Apache 2.0; DINO-X Pro reports 56.0 AP on COCO, 59.8 AP on LVIS-minival, 52.4 AP on LVIS-val (zero-shot) — [Grounding DINO 1.5 arXiv:2405.10300](https://arxiv.org/pdf/2405.10300); [DINO-X arXiv:2411.14347](https://arxiv.org/pdf/2411.14347); [GitHub GroundingDINO](https://github.com/idea-research/groundingdino); [GitHub DINO-X-API](https://github.com/idea-research/dino-x-api)
- Surya (datalab-to/surya): code is Apache 2.0; model weights use a modified "AI Pubs Open Rail-M" license, free for research/personal/startups under $5M funding or revenue, paid license required for broader commercial use — [GitHub datalab-to/surya](https://github.com/datalab-to/surya); [inferensys.com PaddleOCR vs Surya comparison](https://inferensys.com/differences/local-first-ai-agent-stacks/local-document-intelligence-pipelines/paddleocr-vs-surya)
- Surya handles complex layouts, curved text, and low-quality scans robustly; PaddleOCR (with PP-StructureV3) is stronger on tabular/multilingual document layout; PaddleOCR and RapidOCR are described as more lightweight/faster than Surya — [inferensys.com comparison](https://inferensys.com/differences/local-first-ai-agent-stacks/local-document-intelligence-pipelines/paddleocr-vs-surya)
- docTR (mindee/doctr) is a 2-stage (detection + recognition) deep-learning OCR library with pretrained models, described as comparable in performance to Google Vision/AWS Textract on public document benchmarks — [GitHub mindee/doctr](https://github.com/mindee/doctr); [mindee.github.io/doctr docs](https://mindee.github.io/doctr/)
- Google Cloud Vision API's TEXT_DETECTION feature is a managed, high-accuracy OCR service — [Google Cloud Vision OCR docs](https://docs.cloud.google.com/vision/docs/ocr)
- No source found directly benchmarking EasyOCR, docTR, or Google Cloud Vision specifically on stylized game-marketing text/fonts — searches returned only generic tool descriptions, not stylized-text-specific accuracy numbers.

### Inferences
- Given PaddleOCR's documented weakness on stylized/game-category text (see PP-OCRv5 section above), and the lack of any source directly validating EasyOCR/docTR/Google Vision on stylized marketing fonts either, deterministic/self-hosted OCR tools broadly should be treated as "good for plain UI/HUD text, unverified for decorative marketing captions" — a frontier hosted VLM (Gemini/Claude/GPT) is the safer default for the caption-text extraction sub-task specifically, with a deterministic OCR pass used as a cheap first-pass/cross-check rather than the primary source of truth.
- For the "character art bbox" and "banner/device-frame region" sub-tasks, Grounding DINO 1.5/DINO-X (Apache-2.0, IDEA-Research, strong zero-shot AP) is a more directly fit-for-purpose, fully-permissive open-vocabulary detector than Florence-2 or Moondream, since it's purpose-built for high-precision open-set detection rather than general VQA/captioning.
- Molmo 2's Apache-2.0 license with non-commercial-data caveats is a genuine legal gray area for a commercial tool; if considered, its exact training-data terms should be checked against the intended commercial use before relying on it.

### Gaps
- No stylized-game-marketing-text-specific benchmark exists (found) for EasyOCR, docTR, or Google Cloud Vision — cannot state comparative accuracy versus PaddleOCR/HunyuanOCR for this exact use case.
- Layout detection models (e.g., LayoutLM-style, dedicated ad/poster layout detectors) were not directly found as standalone off-the-shelf tools beyond the dataset/paper findings in the design-decomposition section below — no verified, ready-to-use "screenshot layout detector" product/library surfaced in these searches.

## Deterministic tools for colors/composition (dominant color, saliency, background removal, device frame detection)

### Takeaway
Deterministic, fully open-source tooling exists and is mature for dominant-color extraction (ColorThief, k-means via OpenCV/scikit-learn) and background removal to isolate character art (rembg with BiRefNet); saliency detection has usable but older/less-maintained open-source options (OpenCV's built-in saliency module, smaller community toolboxes); no dedicated, purpose-built "device frame / bezel detector" model or library was found — device-frame handling in the wild is done heuristically (aspect-ratio matching) by mockup-generator tools, not by a trained detection model.

### Cited Findings
- ColorThief (fengsp/color-thief-py) is a Python/Pillow library that extracts dominant color or a representative palette via `get_color()`/`get_palette()` — [GitHub fengsp/color-thief-py](https://github.com/fengsp/color-thief-py)
- K-means clustering of pixel RGB values (via OpenCV and/or scikit-learn) is a standard, widely documented technique for dominant-color extraction — [PyImageSearch OpenCV k-means color clustering](https://pyimagesearch.com/2014/05/26/opencv-python-k-means-color-clustering/); [charlesleifer.com blog](https://charlesleifer.com/blog/using-python-and-k-means-to-find-the-dominant-colors-in-images/)
- rembg (danielgatis/rembg) is MIT-licensed as a tool, but bundled/selectable model weights carry their own separate licenses that must be checked independently — [GitHub danielgatis/rembg](https://github.com/danielgatis/rembg)
- BiRefNet ("birefnet-general") is available as a model option inside rembg and is described as the newest/most accurate general-purpose option — [runcomfy.com BiRefNet node reference](https://www.runcomfy.com/comfyui-nodes/ComfyUI_BiRefNet_ll/RembgByBiRefNet); [GitHub 1038lab/ComfyUI-RMBG](https://github.com/1038lab/ComfyUI-RMBG)
- A competing background-removal model, BRIA RMBG-2.0, is CC BY-NC 4.0 and requires a paid commercial license for production use — meaning BiRefNet (via rembg) is the more clearly permissive self-hosted path for commercial background removal — [bestaiweb.ai production background removal comparison](https://www.bestaiweb.ai/how-to-build-a-production-background-removal-pipeline-with-bria-rmbg-2-0-photoroom-api-and-rembg-in-2026/)
- OpenCV provides a built-in `saliency` module with multiple algorithm implementations (e.g., `StaticSaliencySpectralResidual_create()`) with Python bindings — [OpenCV Saliency API docs](https://docs.opencv.org/4.13.0/d8/d65/group__saliency.html); [PyImageSearch OpenCV saliency detection](https://pyimagesearch.com/2018/07/16/opencv-saliency-detection/)
- Smaller/older community saliency toolboxes exist (pyimgsaliency, salienpy) but no indication of active 2026 maintenance was found — [GitHub yhenon/pyimgsaliency](https://github.com/yhenon/pyimgsaliency); [GitHub rafaelolg/salienpy](https://github.com/rafaelolg/salienpy)
- Device-frame/mockup tools (Bezel, Framify, Device Mockup Generator, "frames" open-source Next.js project) detect device frames primarily via aspect-ratio matching heuristics (a `detectDevice()` function keyed on screenshot dimensions), not a trained vision detector — [GitHub bunlongheng/frames](https://github.com/bunlongheng/frames); [usebezel.app](https://www.usebezel.app/)

### Inferences
- For this project's needs, a practical deterministic pipeline is: k-means (via OpenCV/scikit-learn) or ColorThief for dominant-color/banner-color extraction (mature, no license concerns); rembg with the BiRefNet-general model for isolating character art from background art (permissive licensing path, avoiding the CC BY-NC RMBG-2.0 trap); and a lightweight aspect-ratio/edge-detection heuristic (rather than a trained model) for detecting whether a device frame/bezel is present, since no purpose-built device-frame detection model exists in the wild — this may need to be custom-built (e.g., detecting a rounded-rectangle screen area with a hardware-colored border via classical CV edge/contour detection) rather than reusing an off-the-shelf model.
- Saliency detection is the weakest-supported deterministic sub-task here; OpenCV's built-in module is the most current/reliable option found, but its output quality for isolating "the marketing focal point" of a designed graphic (as opposed to natural photo saliency) is unverified.

### Gaps
- No dedicated, trained "device frame / bezel / mockup detector" model or dataset was found; this appears to be an unaddressed niche — confirmed absence, not just missing search results, across several distinct query phrasings.
- No direct evidence on saliency detection algorithms' accuracy specifically on graphic-design/marketing compositions (as opposed to natural photographs) — deep-learning-based saliency models (e.g., U2Net-based) were not directly evaluated for this composition use case in available sources.

## Design decomposition work (LayerD, Crello, CGL, ad/poster layout analysis)

### Takeaway
There is real, recent academic work directly relevant to this task's "decompose the marketing overlay into layers" objective — most notably LayerD (ICCV 2025, raster-to-layers decomposition) and the CGL/Crello poster-layout datasets — but these are research artifacts (code + datasets), not turnkey production tools, and none specifically targets mobile game store screenshots.

### Cited Findings
- LayerD: "Decomposing Raster Graphic Designs into Layers" (arXiv:2509.25134, ICCV 2025) — iteratively extracts unoccluded foreground layers from a single flattened raster design image, with a novel quality metric because ground-truth layer structure is inherently ill-posed; code at CyberAgentAILab/LayerD — [arXiv:2509.25134](https://arxiv.org/abs/2509.25134); [project page](https://cyberagentailab.github.io/LayerD/); [GitHub CyberAgentAILab/LayerD](https://github.com/CyberAgentAILab/LayerD)
- Related, newer work: LaDe ("Unified Multi-Layered Graphic Media Generation and Decomposition," arXiv:2603.17965) and a workflow-aware structured layer decomposition paper for illustration production (arXiv:2603.14925) — both indicate an active 2026 research thread on raster-to-layer decomposition — [arXiv:2603.17965](https://arxiv.org/abs/2603.17965); [arXiv:2603.14925](https://arxiv.org/pdf/2603.14925)
- LICA ("Layered Image Composition Annotations for Graphic Design Research," arXiv:2603.16098) is a 2026 dataset/annotation effort specifically for layered graphic design research — [arXiv:2603.16098](https://arxiv.org/html/2603.16098)
- Crello dataset: ~23,182 web-collected posters/designs, multi-element templates with normalized positional/typographic attributes, but stored in a framework-specific serialization with only coarse element-level properties (no true component hierarchy or vector graphics) — [description sourced via LICA paper's related-work discussion, arXiv:2603.16098]
- CGL-Dataset: 60,548 advertising posters annotated with four coarse element categories (logos, text, underlays, embellishments) plus bounding boxes, used for content-aware layout generation; CGL-Dataset V2 extends it with more content annotations — [Hugging Face creative-graphic-design/CGL-Dataset](https://huggingface.co/datasets/creative-graphic-design/CGL-Dataset); [GitHub CGL-Dataset-v2](https://github.com/creative-graphic-design/huggingface-datasets_CGL-Dataset-v2)
- Related generative/layout-focused work exists in the same space: PosterLlama, PosterLLaVa, SEGA (content-aware layout generation), and a GAN-based domain-adaptation approach for ad poster layout — [arXiv:2404.00995](https://arxiv.org/html/2404.00995v2); [arXiv:2406.02884](https://arxiv.org/pdf/2406.02884); [arXiv:2510.15749](https://arxiv.org/pdf/2510.15749); [arXiv:2604.07409](https://arxiv.org/pdf/2604.07409)

### Inferences
- LayerD's core problem (recovering an editable layer stack from a single flattened image) is structurally close to this project's "decompose marketing overlay layer" goal, but LayerD is designed for graphic-design compositions broadly (posters/ads), not specifically game screenshots with a game-capture region underneath — it would likely need adaptation/fine-tuning rather than being usable off-the-shelf, and as an ICCV 2025 research repo it should be evaluated for code maturity/inference-readiness before relying on it in production.
- CGL-Dataset's four coarse categories (logo, text, underlay, embellishment) map reasonably well onto this project's target categories (caption text, banner/band, character art, background) and could be useful as either training data or an evaluation reference if a custom layout-classification model were ever trained, though it is not itself pretrained for direct inference reuse without a corresponding model.

### Gaps
- No evidence found of any prior work applying LayerD, CGL, or Crello-derived models specifically to app-store/game-store screenshots — this appears to be an unaddressed niche, meaning the target use case would require either adapting general poster/ad-decomposition research or relying on prompting frontier VLMs directly (per the hosted-VLM section) rather than a ready-made decomposition model.
- Could not verify LayerD's inference speed/practicality for a solo dev's pipeline (e.g., whether it runs on CPU, typical inference time per image) — not covered in the sources found.

## Prompting/schema tools: structured output libraries (Instructor, Zod, Pydantic, BAML, Outlines)

### Takeaway
All five libraries are real, current, open-source (free), and each maps to a different fit: Instructor (Python, Pydantic-based, ~3M monthly downloads, ~11K GitHub stars as of 2026) is the most broadly adopted default; Outlines is preferred for high-throughput/self-hosted pipelines needing guaranteed schema compliance without retries; BAML is a contract-first DSL with compiled typed clients across multiple languages, suited to production multi-service setups; Pydantic and Zod are the underlying schema/validation libraries (Python and TypeScript respectively) that Instructor and similar tools build on.

### Cited Findings
- Instructor implements Pydantic-based validation with automatic re-ask on failure, supports 15+ LLM providers (OpenAI, Anthropic, Gemini, Mistral, Ollama, etc.), and has crossed 3 million monthly downloads and 11,000 GitHub stars as of 2026 — [dev.to Top 5 Structured Output Libraries 2026](https://dev.to/thedailyagent/top-5-structured-output-libraries-for-llms-in-2026-48g0); [glukhov.org BAML vs Instructor](https://www.glukhov.org/llm-performance/benchmarks/baml-vs-instruct-for-structured-output-llm-in-python/)
- BAML uses a "contract-first" approach: a compiled DSL that generates typed clients for Python, TypeScript, Ruby, and four additional languages — [glukhov.org BAML vs Instructor](https://www.glukhov.org/llm-performance/benchmarks/baml-vs-instruct-for-structured-output-llm-in-python/); [mr.technology BAML article](https://mr.technology/payloads/baml-schema-engineering-llm-dsl-june-2026)
- Recommendation pattern found across sources: "Instructor is the safest default for most projects starting today," "Outlines wins for high-throughput production pipelines where every failed retry costs real money" and for local models needing guaranteed schema compliance with zero retries, and many teams prototype with Instructor then adopt BAML for production multi-service architectures — [dev.to 2026 roundup](https://dev.to/thedailyagent/top-5-structured-output-libraries-for-llms-in-2026-48g0)
- All five libraries (Instructor, PydanticAI, Outlines, Guidance, Zod) are noted as free and open-source — [dev.to 2026 roundup](https://dev.to/thedailyagent/top-5-structured-output-libraries-for-llms-in-2026-48g0)

### Inferences
- For a solo dev building a Python-based screenshot-analysis pipeline calling hosted VLM APIs (Claude/Gemini/GPT) to emit structured JSON (classification labels, bbox coordinates, caption text, color hex values), Instructor is the pragmatic default given its direct multi-provider support and Pydantic-based schema definition — this aligns well with the project's likely tech stack (Python + Pydantic models for screenshot decomposition schema) more than BAML's separate-DSL/codegen approach, unless a multi-language production service is planned.
- Since none of the hosted VLM providers documented here have a specific "guaranteed logit-level schema constraint" the way local/open-weight inference engines can offer, Instructor's validate-and-reraise pattern (rather than Outlines' hard grammar-constrained decoding, which needs local model logit access) is the more relevant approach when calling hosted APIs.

### Gaps
- No source found specifically benchmarking these libraries' overhead/cost when used with vision+JSON-schema calls (as opposed to text-only structured output) — the general recommendations found are text-generation-focused, not vision-specific.
