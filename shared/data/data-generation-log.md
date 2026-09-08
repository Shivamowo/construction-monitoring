# Schependomlaan Progress Monitoring Data Generation Log

Generated at: 2026-09-08T08:28:05.851Z
Schema Version: 1.0.0

## 1. Inspection of `comparison_all_weeks.xlsx`
- **File Inspected**: `shared/raw-data/Comparison As Planned As Built/comparison_all weeks.xlsx`
- **Sheets Analyzed**: 30, 29, 28, 27, 26
- **Column Structure**: All weekly sheets exclusively contain columns: `Name`, `GUID`, `GlobalID Synchro`, and `GlobalID IFC`.
- **Finding**: Each sheet contains an inventory of missing components relative to the as-planned model. **No volumetric deviation percentages or numerical measurements exist.**
- **Provenance Decision**: `volumetricDeviationPct` is categorized as **`FORGED`** across all deviation records, synthesized with realistic distributions informed by the missing-element lists and on-time statuses. Explicitly noted in `deviation.json` `_provenance`.

## 2. Component ↔ Schedule GUID Join Overlap
- **Total Real IFC Components**: 3561 (parsed directly from `Schependomlaan.ifc`)
- **Event Log Tasks Parsed**: 3661
- **Unique Event Log Component GUIDs**: 2358
- **Join Intersection Count**: 2358 / 2358
- **GUID Join Overlap Rate**: **100.00%**
- **Synthetic Stubs Created**: **0** (Hard Rule 1 adhered to: zero fabricated join stubs).
- **Resolution Method**: Synchro event log GUIDs were mapped to Archicad IFC expressIDs via the CSV Resource field `(#<expressID>)` and `IfcBuildingElementPart` decomposition.

## 3. Fallback for Components with No Schedule History
- **Policy Choice**: **0% completion** (`completionPct = 0.0`) and **`deviationFlag: "not_scheduled"`**.
- **Rationale**: Exactly 1203 components in the BIM model have no scheduled tasks in the event log (e.g. foundational or auxiliary building elements). Defaulting to 0% with `deviationFlag: "not_scheduled"` and `reviewStatus: "pending"` accurately reflects that no planned work was logged or completed, avoiding any misleading implication that an on-time verification took place.
- **Documentation**: Recorded in `fusion.json` under per-record `_provenance.unscheduledFallback`.

## 4. Milestone-Bucket Mapping Table (`metadata.json`)
All 39 unique Dutch construction tasks mapped onto the 6 locked milestone categories (*Framing, MEP, Finishes, Structure, Envelope, Other*):

| Dutch Task Name (Source) | English Translation | Mapped Milestone Bucket |
| :--- | :--- | :--- |
| `Afstorten kanaalplaat` | Grouting hollow-core slabs | **Structure** |
| `Bekisten liftvloer` | Formwork elevator pit floor | **Structure** |
| `Bekisten liftwanden` | Formwork elevator shaft walls | **Structure** |
| `Dakbedekking platte daken` | Roofing flat roofs | **Envelope** |
| `Dakpannen` | Roof tiles installation | **Envelope** |
| `Dakramen` | Roof windows / skylights installation | **Envelope** |
| `Installateurs` | MEP installers / subcontractors | **MEP** |
| `Kanaalplaatvloer leggen (lev. week 16)` | Laying hollow-core floor slabs (delivery week 16) | **Structure** |
| `Leggen breedplaat incl. Veiligheid` | Laying wide-slab precast floors incl. safety measures | **Structure** |
| `Lijmwerk kalkzandsteen elementen` | Adhesive masonry calcium silicate elements | **Framing** |
| `Metselwerk` | Bricklaying / masonry | **Framing** |
| `Metselwerk onderpeil (buitenblad)` | Below-ground masonry (outer leaf) | **Framing** |
| `Nuts invoeren` | Utility service conduit entry | **MEP** |
| `Opstellen` | Site setup / assembly | **Framing** |
| `Opstorten fundering` | Concrete pouring foundation | **Structure** |
| `Plaatsen kozijnen` | Installing window/door frames | **Envelope** |
| `Plaatsen scharnierkap incl. goot en platte daken` | Installing hinged roof structure incl. gutters and flat roofs | **Framing** |
| `Plaatsen stalen kolommen` | Erecting structural steel columns | **Framing** |
| `Prefab betonband` | Precast concrete edge beam | **Structure** |
| `Prefab trappen en bordes` | Precast stairs and landings | **Framing** |
| `Prefab trappen en bordes 2e verd.` | Precast stairs and landings 2nd floor | **Framing** |
| `Randkist` | Edge formwork installation | **Structure** |
| `Staalconstuctie dak` | Roof structural steelwork | **Framing** |
| `Stalen balken` | Structural steel beams installation | **Framing** |
| `Stellen bruggetjes` | Positioning temporary bridge supports | **Structure** |
| `Stellen funderingkist incl. poeren` | Setting foundation formwork incl. pad footings | **Structure** |
| `Stelwerk /lijmwerk lift` | Setting / gluing elevator shaft blocks | **Framing** |
| `Stelwerk buitengevel` | Setting exterior facade profiles | **Framing** |
| `Stelwerk kalkzandsteen` | Setting calcium silicate wall profiles | **Framing** |
| `Stelwerk metselwerk onder peil` | Setting masonry profiles below ground level | **Framing** |
| `Stort` | Concrete pour | **Structure** |
| `Stort liftvloer` | Concrete pour elevator floor | **Structure** |
| `Stort liftwanden` | Concrete pour elevator walls | **Structure** |
| `Wapening` | Rebar / reinforcement placement | **Structure** |
| `Wapening liftvloer` | Rebar placement elevator floor | **Structure** |
| `Wapening liftwanden` | Rebar placement elevator walls | **Structure** |
| `Werkvloer liftput` | Mud slab / blinding concrete elevator pit | **Structure** |
| `Zink goot` | Zinc gutter installation | **Envelope** |
| `Zinken bekleding dakkapelen` | Zinc cladding dormer roofs | **Envelope** |

## 5. Summary of Output Deliverables
| Output File | Record Count | Provenance Breakdown |
| :--- | :--- | :--- |
| `components.json` | 3561 | REAL (geometry, type, materials) + DERIVED (floorZone) |
| `schedule.json` | 3661 | REAL (dates, task IDs, snapshots) + DERIVED (English translation) |
| `deviation.json` | 3561 | REAL (onTimeStatus, pointCloudRef) + FORGED (volumetric %, days, heatmap) |
| `photos.json` | 80 | REAL (drone footage ref) + FORGED (milestone prediction, bounding) |
| `fusion.json` | 3561 | DERIVED (completion %, deviation flag) + FORGED (scores, review status) |
| `safety.json` | 100 | 100% FORGED (synthetic PPE compliance events) |
| `metadata.json` | 1 project | REAL (project info) + DERIVED (timeline, zones) + FORGED (milestone vocabulary) |
| `data.json` | 1 bundle | Full dataset bundle with dataset-level `_provenance` |
