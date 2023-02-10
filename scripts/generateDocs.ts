import Combine from "../UI/Base/Combine"
import BaseUIElement from "../UI/BaseUIElement"
import { existsSync, mkdirSync, writeFileSync } from "fs"
import { AllKnownLayouts } from "../Customizations/AllKnownLayouts"
import TableOfContents from "../UI/Base/TableOfContents"
import SimpleMetaTaggers from "../Logic/SimpleMetaTagger"
import ValidatedTextField from "../UI/Input/ValidatedTextField"
import SpecialVisualizations from "../UI/SpecialVisualizations"
import { ExtraFunctions } from "../Logic/ExtraFunctions"
import Title from "../UI/Base/Title"
import Minimap from "../UI/Base/Minimap"
import QueryParameterDocumentation from "../UI/QueryParameterDocumentation"
import ScriptUtils from "./ScriptUtils"
import List from "../UI/Base/List"
import SharedTagRenderings from "../Customizations/SharedTagRenderings"
import { writeFile } from "fs"
import Translations from "../UI/i18n/Translations"
import themeOverview from "../assets/generated/theme_overview.json"
import DefaultGUI from "../UI/DefaultGUI"
import FeaturePipelineState from "../Logic/State/FeaturePipelineState"
import LayoutConfig from "../Models/ThemeConfig/LayoutConfig"
import bookcases from "../assets/generated/themes/bookcases.json"
import { DefaultGuiState } from "../UI/DefaultGuiState"
import fakedom from "fake-dom"
import Hotkeys from "../UI/Base/Hotkeys"
import { QueryParameters } from "../Logic/Web/QueryParameters"
function WriteFile(
    filename,
    html: BaseUIElement,
    autogenSource: string[],
    options?: {
        noTableOfContents: boolean
    }
): void {
    for (const source of autogenSource) {
        if (source.indexOf("*") > 0) {
            continue
        }
        if (!existsSync(source)) {
            throw (
                "While creating a documentation file and checking that the generation sources are properly linked: source file " +
                source +
                " was not found. Typo?"
            )
        }
    }

    if (html instanceof Combine && !options?.noTableOfContents) {
        const toc = new TableOfContents(html)
        const els = html.getElements()
        html = new Combine([els.shift(), toc, ...els]).SetClass("flex flex-col")
    }

    let md = new Combine([
        Translations.W(html),
        "\n\nThis document is autogenerated from " +
            autogenSource
                .map(
                    (file) =>
                        `[${file}](https://github.com/pietervdvn/MapComplete/blob/develop/${file})`
                )
                .join(", "),
    ]).AsMarkdown()

    md.replace(/\n\n\n+/g, "\n\n")

    writeFileSync(filename, md)
}

/**
 * The wikitable is updated as some tools show an overview of apps based on the wiki.
 */
function generateWikipage() {
    function generateWikiEntry(layout: {
        hideFromOverview: boolean
        id: string
        shortDescription: any
    }) {
        if (layout.hideFromOverview) {
            return ""
        }

        const languagesInDescr = Array.from(Object.keys(layout.shortDescription)).filter(
            (k) => k !== "_context"
        )
        const languages = languagesInDescr.map((ln) => `{{#language:${ln}|en}}`).join(", ")
        let auth = "Yes"
        return `{{service_item
|name= [https://mapcomplete.osm.be/${layout.id} ${layout.id}]
|region= Worldwide
|lang= ${languages}
|descr= A MapComplete theme: ${Translations.T(layout.shortDescription)
            .textFor("en")
            .replace("<a href='", "[[")
            .replace(/'>.*<\/a>/, "]]")}
|material= {{yes|[https://mapcomplete.osm.be/ ${auth}]}}
|image= MapComplete_Screenshot.png
|genre= POI, editor, ${layout.id}
}}`
    }

    let wikiPage =
        '{|class="wikitable sortable"\n' +
        "! Name, link !! Genre !! Covered region !! Language !! Description !! Free materials !! Image\n" +
        "|-"

    for (const layout of themeOverview) {
        if (layout.hideFromOverview) {
            continue
        }
        wikiPage += "\n" + generateWikiEntry(layout)
    }

    wikiPage += "\n|}"

    writeFile("Docs/wikiIndex.txt", wikiPage, (err) => {
        if (err !== null) {
            console.log("Could not save wikiindex", err)
        }
    })
}

console.log("Starting documentation generation...")
ScriptUtils.fixUtils()
generateWikipage()

AllKnownLayouts.GenOverviewsForSingleLayer((layer, element, inlineSource) => {
    console.log("Exporting ", layer.id)
    if (!existsSync("./Docs/Layers")) {
        mkdirSync("./Docs/Layers")
    }
    let source: string = `assets/layers/${layer.id}/${layer.id}.json`
    if (inlineSource !== undefined) {
        source = `assets/themes/${inlineSource}/${inlineSource}.json`
    }
    WriteFile("./Docs/Layers/" + layer.id + ".md", element, [source], { noTableOfContents: true })
})

Array.from(AllKnownLayouts.allKnownLayouts.values()).map((theme) => {
    const docs = AllKnownLayouts.GenerateDocumentationForTheme(theme)
    WriteFile(
        "./Docs/Themes/" + theme.id + ".md",
        docs,
        [`assets/themes/${theme.id}/${theme.id}.json`],
        { noTableOfContents: true }
    )
})
WriteFile("./Docs/SpecialRenderings.md", SpecialVisualizations.HelpMessage(), [
    "UI/SpecialVisualizations.ts",
])
WriteFile(
    "./Docs/CalculatedTags.md",
    new Combine([
        new Title("Metatags", 1),
        SimpleMetaTaggers.HelpText(),
        ExtraFunctions.HelpText(),
    ]).SetClass("flex-col"),
    ["Logic/SimpleMetaTagger.ts", "Logic/ExtraFunctions.ts"]
)
WriteFile("./Docs/SpecialInputElements.md", ValidatedTextField.HelpText(), [
    "UI/Input/ValidatedTextField.ts",
])
WriteFile("./Docs/BuiltinLayers.md", AllKnownLayouts.GenLayerOverviewText(), [
    "Customizations/AllKnownLayouts.ts",
])
WriteFile("./Docs/BuiltinQuestions.md", SharedTagRenderings.HelpText(), [
    "Customizations/SharedTagRenderings.ts",
    "assets/tagRenderings/questions.json",
])

{
    // Generate the builtinIndex which shows interlayer dependencies
    var layers = ScriptUtils.getLayerFiles().map((f) => f.parsed)
    var builtinsPerLayer = new Map<string, string[]>()
    var layersUsingBuiltin = new Map<string /* Builtin */, string[]>()
    for (const layer of layers) {
        if (layer.tagRenderings === undefined) {
            continue
        }
        const usedBuiltins: string[] = []
        for (const tagRendering of layer.tagRenderings) {
            if (typeof tagRendering === "string") {
                usedBuiltins.push(tagRendering)
                continue
            }
            if (tagRendering["builtin"] !== undefined) {
                const builtins = tagRendering["builtin"]
                if (typeof builtins === "string") {
                    usedBuiltins.push(builtins)
                } else {
                    usedBuiltins.push(...builtins)
                }
            }
        }
        for (const usedBuiltin of usedBuiltins) {
            var using = layersUsingBuiltin.get(usedBuiltin)
            if (using === undefined) {
                layersUsingBuiltin.set(usedBuiltin, [layer.id])
            } else {
                using.push(layer.id)
            }
        }

        builtinsPerLayer.set(layer.id, usedBuiltins)
    }

    const docs = new Combine([
        new Title("Index of builtin TagRendering", 1),
        new Title("Existing builtin tagrenderings", 2),
        ...Array.from(layersUsingBuiltin.entries()).map(([builtin, usedByLayers]) =>
            new Combine([new Title(builtin), new List(usedByLayers)]).SetClass("flex flex-col")
        ),
    ]).SetClass("flex flex-col")
    WriteFile("./Docs/BuiltinIndex.md", docs, ["assets/layers/*.json"])
}

Minimap.createMiniMap = (_) => {
    console.log("Not creating a minimap, it is disabled")
    return undefined
}

WriteFile("./Docs/URL_Parameters.md", QueryParameterDocumentation.GenerateQueryParameterDocs(), [
    "Logic/Web/QueryParameters.ts",
    "UI/QueryParameterDocumentation.ts",
])
if (fakedom === undefined || window === undefined) {
    throw "FakeDom not initialized"
}
QueryParameters.GetQueryParameter(
    "mode",
    "map",
    "The mode the application starts in, e.g. 'map', 'dashboard' or 'statistics'"
)

new DefaultGUI(
    new FeaturePipelineState(new LayoutConfig(<any>bookcases)),
    new DefaultGuiState()
).setup()

WriteFile("./Docs/Hotkeys.md", Hotkeys.generateDocumentation(), [])
console.log("Generated docs")
