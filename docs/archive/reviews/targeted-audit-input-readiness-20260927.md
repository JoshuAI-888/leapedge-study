# Targeted audit paired experiment — retained input readiness

Inspected 27 September 2026. Read-only inspection of retained JSON artifacts; no models, network requests, database writes, paid calls or new LeapEdge analyses. This report inventories usable evidence candidates. It does **not** declare the cloud paired experiment frozen or ready to run.

## Findings

- All original **20 video IDs** have retained timed transcript objects and a completed processed-source donor. The transcript objects in the latest completed G/H research donors match the original frozen-cohort transcript hashes for all 20 cases.
- All 20 original source-artifact byte hashes and all 20 canonical transcript hashes match the existing frozen manifest. The selected research context's `analysedAt` equals its original frozen source run's `createdAt` for every case: no silent cutoff movement was found.
- A retained transcript object is **not proof of complete spoken-word coverage**. Every source reports `audioVerified: false`. Cases2 and 3 are explicitly `incomplete_or_unknown` at 83.4% and 87.5% timestamp coverage. Eighteen processed-source donors retain an incomplete source-recall warning; cases 15 and 17 are the exceptions. Timestamp coverage is not semantic recall and gaps can include silence.
- Nineteen cases have nonempty retained external retrieval snapshots. They contain 260 completed retrieval records and 780 result records with text in aggregate (not 780 unique documents). Case 15 has an explicit empty query plan and empty retrieval list; this is retained evidence of **no external search**, not a missing file and not corroboration.
- Both video-date and current-update retrieval modes are retained for each of the 19 searched cases. Retrieval requests span 2026-09-26T22:48:00.636Z through completion 2026-09-27T04:26:20.507Z. These are later retrieval dates; they do not establish that a webpage's contents existed at the video's publication date. Publication eligibility, later developments and date uncertainty must remain separated.
- **Neither new experiment arm has actual frozen/run input bundles yet.** The retained G/H runs are donors, not fresh current-versus-targeted measurements. All 20 need the same chosen transcript, processed-source evidence, external snapshot, cutoff, model configuration and context exported into both cloud arms before admission.

## Per-video availability

“Retained / unverified” means the stored transcript is available in full as an artifact, while complete audio coverage is unproven. All rows have a completed processed-source donor. Percentages below describe timed-span coverage only. Every row still needs new paired-arm export/freeze and cloud import validation.

| Case | Video ID | Transcript availability | Segments | Timed coverage | Original analysis cutoff (UTC), preserved | External snapshot | Donor |
|---|---|---|---:|---:|---|---|---|
| 1 | `SPIRV9UjNYU` | Retained / unverified | 173 | 91.4% | `2026-09-20T04:29:09.678Z` | 10/10 complete; 30 text results | G2 |
| 2 | `J_VpfkM74Wk` | Retained / **incomplete-or-unknown** | 326 | 83.4% | `2026-09-19T22:41:00.548Z` | 16/16 complete; 48 text results | G2 |
| 3 | `9nb3fp76Rz0` | Retained / **incomplete-or-unknown** | 268 | 87.5% | `2026-09-19T22:41:00.554Z` | 14/14 complete; 42 text results | G2 |
| 4 | `3u24qyWjSVM` | Retained / unverified | 278 | 91.0% | `2026-09-19T22:41:00.560Z` | 16/16 complete; 48 text results | G2 |
| 5 | `M1FJ5dNiBEs` | Retained / unverified | 369 | 100.0% | `2026-09-20T04:29:09.700Z` | 16/16 complete; 48 text results | H3 |
| 6 | `LF7fgz1HAFs` | Retained / unverified | 345 | 100.0% | `2026-09-19T23:09:34.470Z` | 12/12 complete; 36 text results | G2 |
| 7 | `U32FPvvBaNI` | Retained / unverified | 563 | 99.5% | `2026-09-19T22:41:00.576Z` | 16/16 complete; 48 text results | G2 |
| 8 | `jPy5aDhMsMY` | Retained / unverified | 853 | 99.7% | `2026-09-19T22:41:00.581Z` | 16/16 complete; 48 text results | G2 |
| 9 | `elD62rk5Ijo` | Retained / unverified | 549 | 100.0% | `2026-09-19T22:41:00.590Z` | 16/16 complete; 48 text results | G2 |
| 10 | `zYeJZu1hkdM` | Retained / unverified | 451 | 100.0% | `2026-09-19T22:41:00.599Z` | 16/16 complete; 48 text results | G2 |
| 11 | `ZfOQoh82JTo` | Retained / unverified | 1692 | 99.9% | `2026-09-20T04:29:09.714Z` | 16/16 complete; 48 text results | H3 |
| 12 | `iBMZc7zs_Ew` | Retained / unverified | 1335 | 99.4% | `2026-09-19T22:41:00.624Z` | 16/16 complete; 48 text results | H3 |
| 13 | `tUR0w-LDSbU` | Retained / unverified | 255 | 100.0% | `2026-09-19T22:41:00.634Z` | 4/4 complete; 12 text results | H8 |
| 14 | `DuIyF_34ReI` | Retained / unverified | 304 | 100.0% | `2026-09-19T22:41:00.639Z` | 12/12 complete; 36 text results | H8 |
| 15 | `QEwLInO3iZY` | Retained / unverified | 19 | 100.0% | `2026-09-19T22:41:00.654Z` | **Empty by recorded plan** | H8 |
| 16 | `IjYr5acuBT4` | Retained / unverified | 521 | 100.0% | `2026-09-19T22:41:00.659Z` | 16/16 complete; 48 text results | H8 |
| 17 | `pWnu1C8I6Xw` | Retained / unverified | 46 | 100.0% | `2026-09-19T22:41:00.663Z` | 10/10 complete; 30 text results | H8 |
| 18 | `1WNowIoNgtg` | Retained / unverified | 1030 | 100.0% | `2026-09-20T04:29:09.729Z` | 10/10 complete; 30 text results | H8 |
| 19 | `vrTbCxUzRw4` | Retained / unverified | 544 | 98.0% | `2026-09-19T22:58:44.927Z` | 16/16 complete; 48 text results | H19R |
| 20 | `Dy_0RtmAt1U` | Retained / unverified | 337 | 95.6% | `2026-09-19T22:41:00.689Z` | 12/12 complete; 36 text results | H8 |

Case 11 is the long video: 1,692 retained caption segments, 3,920-second metadata duration and 99.87% timed-span coverage. It is a retained native-caption replay, **not** proof that long-video ASR acquisition succeeds. Its donor still explicitly warns that source recall is incomplete. Preserve the full transcript and this warning; do not label the long case fully verified because processing completed.

Case 15 is a 38-second research-framework clip. Its retained plan has zero external queries and the research output contains two sentences. Decide and document before freezing whether the new experiment preserves that explicit no-search condition. Do not silently synthesize external “verification” from an empty snapshot.

## Retained donor provenance

Selection here: latest `updatedAt` completed research run among the four retained G/H terminal snapshots listed below. This yields 9 G2, 3 H3, 7 H8 and 1 H19R donor. Historical failed/review observations remain in the original artifacts; selecting a donor input does not remove their costs or convert those runs into successes.

| Alias | Retained artifact | Byte SHA256 |
|---|---|---|
| Frozen source cohort | `data/readiness-20260927/frozen-cohort.json` | `d43c51bfb6846bcc28afc0a344ccbe0caa97ffd778595ffe4e97dc182ee15551` |
| G2 | `data/readiness-20260927/candidate-g-session-2.json` | `ae7a0db779b20fdc5252e69d2777682ce0d4de0b0c2bc01e4a9375a698d1ecbc` |
| H3 | `data/readiness-20260927/candidate-h-session-1.json` | `8797bdf169ae72914b9230a2d766029c0f6cdb2aaa4771c9ac7ad8e796071fb0` |
| H8 | `data/readiness-20260927/candidate-h-remaining8-session-2.json` | `cded7a3921510764aee01aaed24e62375e29b0ec5879084d717920a65df50cc7` |
| H19R | `data/readiness-20260927/candidate-h19-audit-recovery-session-1.json` | `8d7eece7ca5ea046f607866558653c90ea6ccc92428127f9075dbe7a6747a63a` |

The frozen source cohort manifest was generated at 2026-09-26T20:56:15.061Z. Object hashes below use canonical JSON with recursively sorted object keys and original array order; artifact byte hashes above use original file bytes. They must not be interchanged.

| Case | Original source run ID | Selected processed-source run ID | Selected research run ID |
|---|---|---|---|
| 1 | `fdadcc82-6ad4-43ea-9bf3-9de06f901a94` | `85bf107c-0a7b-4956-83c4-6ac841f8f1ef` | `a9a21faa-dfa2-4c43-b507-97266cda0c49` |
| 2 | `db6105c1-2ae2-4382-9adc-fb18b1ffadc5` | `8bf39113-b96c-417e-9923-c8f4155ea8b5` | `25dad422-a31e-4095-a3ae-f2273190094d` |
| 3 | `f90aebeb-06c3-49db-8e7d-fc9d1e6c1ad4` | `cc875d2f-0362-44d0-bcf7-f317665d7503` | `323cac92-cc10-43d3-a3f4-e747a917e606` |
| 4 | `73b9ed06-b2f4-427e-bffc-367bf2c2219c` | `8b651034-eac1-4c77-a7b1-a4821d84b9c2` | `824d2d60-0e0c-411b-829d-4646cefc9b39` |
| 5 | `4f4c1154-01cf-4675-be12-671aed73b322` | `63900152-5a86-44f8-b358-ec17b160818e` | `cb32bd0f-3141-465e-a008-6db8fe37d72e` |
| 6 | `06a2ff95-de50-45ce-874c-add16edf63b5` | `6a83a3b9-2907-49fb-8c93-c1d3b623af3e` | `4509b00d-1fdf-484e-ae27-cf9711d3d823` |
| 7 | `7de93e5e-8fb4-45f2-a316-c7dd2d4211af` | `61da3563-d48c-4ffe-acce-20bd29de49da` | `a587937e-deae-417e-ac10-67ac244af899` |
| 8 | `83858f51-80f8-4237-9c8f-b7f3c27ac89c` | `c5066d52-8625-4049-b615-48e5985502b8` | `5bc8c322-7a0a-4033-8218-2b2ce90c7c5e` |
| 9 | `e0509996-cf3c-45b4-91ef-90613fb1ff72` | `e352b5e3-6dad-43c1-b67a-b008704eb850` | `c69faf76-63c3-4cdc-bcad-765cb3725942` |
| 10 | `5af3ed33-5175-4b67-8503-9858cf8dbbb6` | `d652c2bb-dbcb-4900-96f9-c716358e55b9` | `a38a3ecf-bdda-43be-9a48-6eeb02406dad` |
| 11 | `2a8dba98-20fe-4241-a618-11638f878bf9` | `b2d18482-5994-4996-af2e-35ac4e8842fd` | `d6a67b98-64c0-4719-ae39-59c55a42d388` |
| 12 | `6ea1a4b7-f5ee-4096-9acc-1e6f48a89c73` | `7306a0b9-2689-4f41-99e2-a9927c06067c` | `386f608b-03a6-430d-81e9-bd26c4141aab` |
| 13 | `883b7b0e-9003-4233-b777-7c2abd3b1255` | `30e86cc6-e009-4a68-ad52-a9a7dcc042dd` | `b13254e5-4fd9-4ee7-aac8-6b7e7f93f844` |
| 14 | `8f06312c-8fbc-4f01-9763-61e82789a1ab` | `a9fa2215-367c-4b4f-ab33-1becb1577f53` | `f4778ca3-a0b0-43b9-8da5-8600c3f0fb10` |
| 15 | `c34b384d-58d7-469e-a181-1e8fbfd498e6` | `447f5dfa-718f-4d3f-9589-639b4a4c76a5` | `9f8e8d15-a062-4e76-b8ee-761482e834d4` |
| 16 | `12d3f814-b1d2-4a6f-a235-c305df712031` | `599984b0-0f07-49f9-9b25-721a198dd9bf` | `a76d53a9-c16f-4c41-8347-25461fbc46b0` |
| 17 | `21589b3f-ffeb-4382-8762-68cbb25b3197` | `9d2424eb-1383-4480-b969-eb7b221a0e23` | `eb60d694-b38c-4ba9-bba3-92ef8ab82796` |
| 18 | `606a763f-6f0e-4d67-a8c6-6a81a2c86b6d` | `fb769030-8731-4ea3-a262-5cb733b496dc` | `a0b17ec4-fe6f-4885-ab90-f37bf1a1a010` |
| 19 | `1ceaf3a6-8b2e-4964-91ff-b61b40367c61` | `a3b4ec19-1cfc-452e-b3f9-2e66c287609f` | `40933a7e-bfe9-4ee5-93c0-116178063e7d` |
| 20 | `9e9a45fe-e8fc-4d64-9f45-f6bfd8c44d26` | `210a4f30-55bb-46a3-959d-b6ca05f2b0f1` | `6f64bb01-c4a4-4882-b5a5-005841c0b480` |

## Input hashes to preserve in the new freeze

“Transcript” hashes only `source`; “processed source” hashes the complete selected source-run output; “retrieval” hashes the complete retained retrieval list, including returned texts and metadata. Matching transcript hashes do not establish matching extracted inventories: **all 20 selected processed-source outputs differ from their original frozen-cohort output objects**, which include different processing results/provenance. Choose one processed-source donor per pair and freeze its complete research snapshot, not only the transcript hash.

| Case | Transcript SHA256 | Selected processed-source output SHA256 | Retained retrieval-list SHA256 |
|---|---|---|---|
| 1 | `53854949c0d256c9a7a600a8a368869b19dff4277ef35ad21c0b57f2b64b69de` | `b65db0ef5bef3a301f878f333453e1a0e414be2db5aa97c3e22ee22e925725ec` | `75b8358526dd62ecdad5a45ece18980329f7026268c83394a6639c89dd29e7a5` |
| 2 | `386a30d86c4feabd4090105e00212ee24ed1759b6b4e9f87d77d14b2289fde12` | `334b73bbf96959bfcc21adc0622470f5f21641fa014f1cf60736f62568f99dd4` | `cfa7f53ecabb11431643c19505dcd4c37c06b5ef320ea8946a4434d66a339e90` |
| 3 | `c5b15db302e70e97e3b812db633e2c347e3d57f039b1e83bc8a742c91748be1d` | `7dda10f75e02da6edb34c4e5b2af9bd4d88e11377261ffbb2a0379e030b57cf4` | `a5a39b6b45fb5ea792e9a83fe2a6839ff75db4c697e4944a286369d9ef444dfe` |
| 4 | `279c03f57ee14ada3a52bc42c2187c862cc2c5b9e3f49b4c5d7027b768709034` | `3c8df3a725dcce6f44efda613a04de5755b6666e5bef4effd2aaa3903811246a` | `b7234ab655b7ffdcfd929e49c85760bd25b87ad15bb161bb609f64da28933bfa` |
| 5 | `740688a877751f92b6996c1192ec7ec8fe6240b0f955cb753a1696d8dea755fc` | `3ec7b8f9743a18f563f3fcd6ca477251ecd7f7f2666520d5d4595e70a1a1f190` | `025c4e33416090dd0cf6ce9362561d894249019fecc55962f4c00fb1050ba7e6` |
| 6 | `072935e3261580aecf72373cda7b6969306a1b5ea3fea98de5b66ec9dea47d35` | `6abf545363b29ef8ad3e0cc9eb12dd58f86a518e1797bdde01c90588d94f24bf` | `0bac334fdccacff5aacddd3c0f28d30ac13de4d0a01b13ceced27789c4ff0951` |
| 7 | `3ebd4227fc90b8c6705aa70ee4314de5f1b405227bc4b7f7b4347e5ac25783d4` | `ba039f3274e88536406a3f9dbd1f5d6474b30f33bc42d8f003b1d1b857a58cf8` | `f80927f3266d3ac78e7da5edb20de1aeece5c79696c1225d453eca66bd332cab` |
| 8 | `827a45bd6649786595c6f4294ab4a1b4cb52b55c97efb402effb7615639b5a99` | `003114a528aaf5dd87518e23a20f076a8456ff2125b3766e5cb5ac8c112c0c3c` | `640e08b25faaf8c00517ac3be4bac05c66072330d5f0e02b2dece2d25d6ec58f` |
| 9 | `17824c09c42b1086eb3fd121299fb02c4f8bed2599344d907fef3442c339ae84` | `236ee772469406530753280fbc2aefe4ff090889f188f9b565e4681f567ef12e` | `9facef81eaf38d0c9c99584a1c519004da01b0c5f74fecc9472146db5d0e5ccd` |
| 10 | `e88f0e7d923a58b236fec4909514295b56858335ed62847ba644ef3a3b76761f` | `f9f1fee7d0d7c79757d9f0789ccffbbf15917a3e51390534625f22c5bbd3eda7` | `a601ad61e08c3a8736ff006b9d06631a8e9d60a66b7b08ce5ecf89ceca9caae9` |
| 11 | `284bfd23f16b63f218bfb7e80e9189c0c187a9ed2e18f6bb44b4e437dfb46c39` | `c5eaccb390934df7a4ccc2df0c03e10dd8f9c6e3862b054b832471d5be360c85` | `e4046cad4bfe8f9e315d5d0b8425fdc27bfafffe8dab5c776d0ad108dba9c04b` |
| 12 | `8c7862100a0c8e0991fdbb8151a26609c8b3e322dc153f27c63b3f159f8ba68c` | `31faf1af899541cb663a2588016ce1c4d52b04f6accef3990fa125ce8d183349` | `2b9e906f50f7945e0511f6ff6efc88a971db8f808342b38db93fdc1af5765439` |
| 13 | `140fa8b1c7d5bac6f8bf881325c97ba287285c763675eef506f7a7c9db1a2692` | `b904d48bf0c7c789052f9fa76bd54d7bad2dddb450db2b0104ea2b6133d5f9b7` | `02e149b3e161e0c5735f6be98da1f49239b1343936c716de73132484d4004a3f` |
| 14 | `469b9cfe65f45410ddca534d610ea12f41568b4f11744fb3c190eebb2215e143` | `a795efcaeaf988537b1ee66ebd0ac88c492372e827a43f7e5150284f2920ce21` | `c7f08163eaa060f9b8457d992cf583527e8f9922592784326ba6ac090b395f51` |
| 15 | `9f6f9d29849005546a3a1327fd3c72ae08d732135a99055dddf2814975409d33` | `0484ce3742da266f71870854f35b5540569f2151425d78aa66141db11be02bca` | `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| 16 | `41777f1c71c290530e028972e4d2ba13479d9b0971b48f2b8c9d6aea1674ab8f` | `d1432c7b3f0a237c1f7417a4929a212c52495f2010138498f7bc9273ad0ccd7f` | `f602f1c422c46a95300fa58a382f2d70d2763e33df27bd678834821fc0551812` |
| 17 | `6876a0eefdd20d90898fd8587ee0900b7f2c4c31269855835d10a75ca11896db` | `e12abba26c963a3a381967d7187a03b96afca740d24dfa9a92f12b5437c24858` | `7aee3f860d3429ed043f615204f02942dffd3a2947355a500fa1e7ff84fca696` |
| 18 | `4b8fdad853bb0efa6d824bb4af6cbe917a482fb7fe6bc3f85d1c581bbdc26f45` | `29b7608332ed7afcbe5ef255e8648c645f60e9e03f83211d34d0493040ea9570` | `64cd18341d8daee10f059eb9fda2580b210feca413909bd23ee4f3ff4958044e` |
| 19 | `94c37478c9994a811fe700eba5416afe1ab30ba802ab1567cc0addd975c320b6` | `95207df00c233fef2a2601b84d69090271759b804b32451c6c386d3f9aea4fde` | `9b81b66b47a400d6773b8e23c5e89769ccf4b57dfd47139cc32408d8da9c1ebe` |
| 20 | `20116fb104d4eda5c9f7e48707131a0e4f0ca58fe5ab3bea9d0c3cd5b8ca6646` | `99cb0e5d0047a61484de2fb60af92c34615a88cdcf2f6e49f0b4cc02d592eee0` | `b4f212f4dfd4eb26aa335d8027261923319c93580899c691d37cb3bd1d984aa5` |

The research-input snapshot contains the selected source ID, context, evidence inventory, historical baseline and inventory omissions. These entire snapshots—not just individual source passages—are available under each donor research run's `input.snapshot`.

| Case | Research snapshot SHA256 | Context SHA256 |
|---|---|---|
| 1 | `e8bbed461c39b8d9354ecfd4301e8f7b4a9a4dc8e340a09357752ba5850ea6b0` | `6d63593689fa3fc7345f25a5db76e1bde1f9bfbdf7154220d8b0f55bcdc55edf` |
| 2 | `1bab3dcdba26303c8e26770e87f581e181e941ec556ddd8a2524cf4ff89fb1c2` | `c72d3bf49b8e163830ecb36a8483b6f5ff8314bb0ffacb9c0de606ea0d14cb7f` |
| 3 | `16f35d72bfe9a3edb669e501127b91a1a46f3a2ea0bf167aaef53c6f35d50f6b` | `2aab0a784ea662940bdab777555acc30f99f52e1061e3053d1529d96f7d46b03` |
| 4 | `718f18217d2c61016ed5d97116b6de559d56569ce6bcf5dc4b630d64f34c55fc` | `71f36fb3ae50580cc2abf1daa62dd12b3e804d7583cb129c3a07cf468b8776ae` |
| 5 | `b8c6b5b403c805672018c397cb91d8ad05c63d5c320523d28a7c92cc783f9f7c` | `9761866901d9fe17d4cca32c199ebeaa03ac1675b1eed3885df306fd1f9c5929` |
| 6 | `7c60ba77e19329ee7c5360ea9521ffa65914e8110d876a33ce22c3f8399739ac` | `516220ad66d0e31100a3ddadc4b5a964ce541f3c389d18b8c621d24f2259fa08` |
| 7 | `4ee13eeb365b0f86fe36937676c96283c20f776d87020222953ddf013055d685` | `de97904bd5fa838f0eb765cfd57eff0fc8b7681c7310ce14557d9455a8ab2363` |
| 8 | `bbe07716efb39c93617947761cce6d48b57b48b618883ad2732b39840987e221` | `9638a22116ee3cf91ed01674b20860bf34f7328eef54b075350fad52ad24e50f` |
| 9 | `be87ea8674d55f3d26893159df996cb7fadf7da91f9e6edc2b0c07d9214a96e8` | `776a428c61e394556f222c1539c6c11de4a3a049d88aa688e690920feae7de76` |
| 10 | `6ef1523fce8ff71163507ab52ad43e213be1845a65fca91295f5cbfee8d904df` | `379553f7d29d80a456fdfbfa690a42a6b2256e6453cb0c8b35072c26dd895684` |
| 11 | `795142f2d3e6c603280a2eb7cfbc1e46f9cdb16b50e49a8e550c44f038ef7019` | `8a5025576c04d0ce60282a7a9884b8c96ff613564f2bb4240a3e405298bb7d8f` |
| 12 | `3fb57272dd4a10a4157c28ba509accbc749d85344f95821b7c22f972f1e6d565` | `c6cd47aa00326a6f6d532998e2ce984e81fd0752c7cf4f9c53ee45fd2a402988` |
| 13 | `09df234974907e5da181b56702e9421ba3c3f0f9913aff7325b1ee54de4ab9c8` | `c399b5d04e833651acc5e99a42b16ce6d0e815ce4104ab163eb7ff575fdcfe54` |
| 14 | `54f61d881a7c944a66fa72f61656f607fc458a6aef70f2a59acb6f1ae12b1aa4` | `69e377beb7ca2567354f6fed7262098acb90457a24238080011f11a135b24f6b` |
| 15 | `a190bfe4756b6c4dda0a7948c08dcc44abc436c1b5c0179619e191faae8ac0df` | `bf13c085a52a451c6e4cdb1a5d8a62bc18fc0238fcf8553bc23fada837d58246` |
| 16 | `4c097c04056375cca667f7b67b0f0af5aa54084b3b028784ce3e576c41f3fd8c` | `35efe35a5fa60b81ab14c37e00a493dcddc1f21198748615f6afe581cfd624f0` |
| 17 | `af9e6d73e82ce794b080503fade243ef4ef6e6d64f3d511e3e16be69e674f3d1` | `c1f477f05662e2da2372e6294f73fb8741f3ef5cc57ff0f9ac6512891803aebd` |
| 18 | `5548726e6beb433d2438f8c1e40bfd73b295b8ee067bd8193700e56a4f885309` | `5cdcd4f71c56a807641f026b865e7db65a22d4d446ca9fc62a710db9f5b83862` |
| 19 | `ff55a766cb832efd9308da333a20bba96bfae5ce3b9cd06a0ef155406c02bfd1` | `cf26192d4944958f5098e755650f9d1b2878883006d3e231b9cef7ebfe52c800` |
| 20 | `52f5f6e6abb62b5578d7e460e869c24487e5aa385063aa4382394b12aa76c962` | `7f9353da501883fc7bc40f4ec7a94e8ab12aae09c70ec083206e33e7e831332d` |

## Checklist disposition and remaining work

| Frozen-input checklist item | Readiness | Required next action |
|---|---|---|
| Original 20 IDs and retained transcripts | Available; full semantic/audio coverage unproven | Export complete transcript artifacts; preserve source limitations; examine cases 2/3 and long-video coverage without dropping them. |
| Completed processed-source donors | Available for 20 | Freeze the same complete processed snapshot in both arms. Do not compare original inventories against later G/H inventories as though inputs were identical. |
| Original analysis cutoffs | Available and matched for 20 | Preserve the per-case cutoff shown above, separately from publication and retrieval dates. |
| External retrieval snapshots | Nonempty for 19; explicitly empty for 1 | Package query/result texts, dates, uncertainty and mode separation identically for both arms; declare case 15 no-search policy. |
| Source-backed known-failure and held-out review sections | Not frozen by this inventory | Select and hash review-section manifests before execution; retain transcript span references and output statement mappings. |
| Baseline/current arm input bundle | **Not created** | Export the chosen common donor inputs into the current pipeline's new cloud admission. |
| Targeted arm input bundle | **Not created** | Export those exact common inputs into the targeted pipeline's new cloud admission. |
| Same model/settings and implementation manifests | **Not frozen for the new pair** | Explicitly choose common models and settings; freeze distinct pipeline/configuration manifests. Historical G/H model settings do not establish the new arms' equivalence. |
| Cloud copies and hashes | **Not validated** | Provision only under approved topology/costs; transfer required artifacts and verify byte hashes, complete inventory tables and source links after import. |
| Cloud execution/export adapter | **Pending** | Add immutable plan hash, complete admission registry, all-attempt ledgers/traces, source replay and paired output export. Do not use the Mac-specific durable controller unchanged. |
| Fresh paired 20 measurements and source-backed review | **Not run** | Generate fresh draft/audit work on both paths; retain failures/retries/costs. Historical recoveries are not the new baseline. |

This inventories inputs for a **research-only** paired test using shared retained sources. It excludes fresh ingestion/ASR acquisition from its timing and cost boundary. A later end-to-end cloud benchmark must measure source acquisition, queueing and browser display separately. The current pipeline remains the default; this inventory does not satisfy promotion gates or grant promotion approval.
