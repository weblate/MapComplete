import FeatureSource from "./FeatureSource";
import {UIEventSource} from "../UIEventSource";
import * as $ from "jquery";
import {control} from "leaflet";
import zoom = control.zoom;
import Loc from "../../Models/Loc";
import State from "../../State";
import {Utils} from "../../Utils";
import LayerConfig from "../../Customizations/JSON/LayerConfig";


/**
 * Fetches a geojson file somewhere and passes it along
 */
export default class GeoJsonSource implements FeatureSource {

    features: UIEventSource<{ feature: any; freshness: Date }[]>;

    private readonly onFail: ((errorMsg: any, url: string) => void) = undefined;

    private readonly layerId: string;

    private readonly seenids: Set<string> = new Set<string>()

    constructor(locationControl: UIEventSource<Loc>,
                flayer: { isDisplayed: UIEventSource<boolean>, layerDef: LayerConfig },
                onFail?: ((errorMsg: any) => void)) {
        this.layerId = flayer.layerDef.id;
        let url = flayer.layerDef.source.geojsonSource;
        const zoomLevel = flayer.layerDef.source.geojsonZoomLevel;

        this.features = new UIEventSource<{ feature: any; freshness: Date }[]>([])

        if (zoomLevel === undefined) {
            // This is a classic, static geojson layer
            if (onFail === undefined) {
                onFail = errorMsg => {
                    console.warn(`Could not load geojson layer from`, url, "due to", errorMsg)
                }
            }
            this.onFail = onFail;

            this.LoadJSONFrom(url)
        } else {
            // This is a dynamic template with a fixed zoom level
            url = url.replace("{z}", "" + zoomLevel)
            const loadedTiles = new Set<string>();
            const self = this;
            this.onFail = (msg, url) => {
                console.warn(`Could not load geojson layer from`, url, "due to", msg)
                loadedTiles.delete(url)
            }

            const neededTiles = locationControl.map(
                location => {

                    if (!flayer.isDisplayed.data) {
                        return undefined;
                    }

                    // Yup, this is cheating to just get the bounds here
                    const bounds = State.state.leafletMap.data.getBounds()
                    const tileRange = Utils.TileRangeBetween(zoomLevel, bounds.getNorth(), bounds.getEast(), bounds.getSouth(), bounds.getWest())
                    const needed = new Set<string>();
                    for (let x = tileRange.xstart; x <= tileRange.xend; x++) {
                        for (let y = tileRange.ystart; y <= tileRange.yend; y++) {
                            let neededUrl = url.replace("{x}", "" + x).replace("{y}", "" + y);
                            needed.add(neededUrl)
                        }
                    }
                    return needed;
                }
            );
            neededTiles.stabilized(250).addCallback((needed: Set<string>) => {
                if (needed === undefined) {
                    return;
                }
                needed.forEach(neededTile => {
                    if (loadedTiles.has(neededTile)) {
                        return;
                    }

                    loadedTiles.add(neededTile)
                    self.LoadJSONFrom(neededTile)

                })
            })

        }
    }

    /**
     * Merges together the layers which have the same source
     * @param flayers
     * @param locationControl
     * @constructor
     */
    public static ConstructMultiSource(flayers: { isDisplayed: UIEventSource<boolean>, layerDef: LayerConfig }[], locationControl: UIEventSource<Loc>): GeoJsonSource[] {

        const flayersPerSource = new Map<string, { isDisplayed: UIEventSource<boolean>, layerDef: LayerConfig }[]>();
        for (const flayer of flayers) {
            const url = flayer.layerDef.source.geojsonSource
            if (url === undefined) {
                continue;
            }

            if (!flayersPerSource.has(url)) {
                flayersPerSource.set(url, [])
            }
            flayersPerSource.get(url).push(flayer)
        }

        console.log("SOURCES", flayersPerSource)

        const sources: GeoJsonSource[] = []

        flayersPerSource.forEach((flayers, key) => {
            if (flayers.length == 1) {
                sources.push(new GeoJsonSource(locationControl, flayers[0]));
                return;
            }

            const zoomlevels = Utils.Dedup(flayers.map(flayer => "" + (flayer.layerDef.source.geojsonZoomLevel ?? "")))
            if (zoomlevels.length > 1) {
                throw "Multiple zoomlevels defined for same geojson source " + key
            }

            let isShown = new UIEventSource<boolean>(true, "IsShown for multiple layers: or of multiple values");
            for (const flayer of flayers) {
                flayer.isDisplayed.addCallbackAndRun(() => {
                    let value = false;
                    for (const flayer of flayers) {
                        value = flayer.isDisplayed.data || value;
                    }
                    isShown.setData(value);
                });

            }

            const source = new GeoJsonSource(locationControl, {
                isDisplayed: isShown,
                layerDef: flayers[0].layerDef // We only care about the source info here
            })
            sources.push(source)

        })
        return sources;

    }

    private LoadJSONFrom(url: string) {
        const eventSource = this.features;
        const self = this;
        $.getJSON(url, function (json, status) {
            if (status !== "success") {
                console.log("Fetching geojson failed failed")
                self.onFail(status, url);
                return;
            }

            if (json.elements === [] && json.remarks.indexOf("runtime error") > 0) {
                console.log("Timeout or other runtime error");
                self.onFail("Runtime error (timeout)", url)
                return;
            }
            const time = new Date();
            const newFeatures: { feature: any, freshness: Date } [] = []
            let i = 0;
            let skipped = 0;
            for (const feature of json.features) {
                if (feature.properties.id === undefined) {
                    feature.properties.id = url + "/" + i;
                    feature.id = url + "/" + i;
                    i++;
                }
                if (self.seenids.has(feature.properties.id)) {
                    skipped++;
                    continue;
                }
                self.seenids.add(feature.properties.id)

                let freshness : Date = time;
                if(feature["_timestamp"] !== undefined){
                    freshness = new Date(feature["_timestamp"])
                }
                
                newFeatures.push({feature: feature, freshness: freshness})
            }
            console.log("Downloaded "+newFeatures.length+" new features and "+skipped+" already seen features from "+ url);
            
            if(newFeatures.length == 0){
                return;
            }
            
            eventSource.setData(eventSource.data.concat(newFeatures))

        }).fail(msg => self.onFail(msg, url))
    }

}