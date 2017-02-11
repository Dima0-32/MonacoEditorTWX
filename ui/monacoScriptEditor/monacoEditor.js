TW.jqPlugins.twCodeEditor.monacoEditorLibs = [];
TW.jqPlugins.twCodeEditor.prototype.insertCode = function (code) {
    var thisPlugin = this;
    var op = {
        identifier: {
            major: 1,
            minor: 1
        },
        range: thisPlugin.monacoEditor.getSelection(),
        text: code,
        forceMoveMarkers: true
    };
    thisPlugin.monacoEditor.executeEdits("insertSnippet", [op]);
};
TW.jqPlugins.twCodeEditor.prototype.setHeight = function (height) {
    var thisPlugin = this;
    var jqEl = thisPlugin.jqElement;
    var container = jqEl.find('.editor-container');
    container.height(height);
    if (thisPlugin.monacoEditor) {
        thisPlugin.monacoEditor.layout();
    }
};
TW.jqPlugins.twCodeEditor.prototype.showCodeProperly = function () {
    var thisPlugin = this;
    var jqEl = thisPlugin.jqElement;
    var codeTextareaElem = jqEl.find('.code-container');
    codeTextareaElem.on("keydown keypress keyup", function (e) {
        e.stopPropagation();
    })
    var vsRoot = '/Thingworx/Common/extensions/MonacoScriptEditor/ui/monacoScriptEditor/vs';
    // hide the toolbar since we have all the toolbar functionality in the editor
    jqEl.find('.btn-toolbar').hide();
    // make sure the textArea will strech, but have a minimum height
    codeTextareaElem.height("100%");
    codeTextareaElem.css("min-height", "365px");
    if (thisPlugin.monacoEditor !== undefined) {
        // already done, don't init the editor again
        return;
    }
    var mode = 'javascript';
    switch (thisPlugin.properties.handler) {
        case 'SQLCommand':
        case 'SQLQuery':
            mode = 'sql';
            jqEl.find('[cmd="syntax-check"]').hide();
            break;

        case 'Script':
            jqEl.find('[cmd="syntax-check"]').show();
            break;
    }


    require.config({
        paths: {
            'vs': vsRoot
        }
    });
    require(['vs/editor/editor.main'], function () {
        if (thisPlugin.properties) {
            // if this is the first initalization attempt, then set the compiler optios
            if (!TW.jqPlugins.twCodeEditor.initializedDefaults) {
                // compiler options
                monaco.languages.typescript.javascriptDefaults.setCompilerOptions({
                    target: monaco.languages.typescript.ScriptTarget.ES5,
                    allowNonTsExtensions: true,
                    noLib: true
                });
                var coreDefsName = 'lib.es5.d.ts';
                $.get(vsRoot + "/language/typescript/lib/" + coreDefsName, function (data) {
                    // Register the es5 library
                    monaco.languages.typescript.javascriptDefaults.addExtraLib(
                        data,
                        coreDefsName
                    );
                });
                loadStandardTypescriptDefs();

                TW.jqPlugins.twCodeEditor.initializedDefaults = true;
            }
            // remove the previous definitions
            removeEditorDefinitions();
            var serviceModel = jqEl.closest("tbody").find(".twServiceEditor").twServiceEditor("getAllProperties");
            var meThingModel = serviceModel.model;

            var entityName = meThingModel.entityType + '' + meThingModel.id.replace(/^[^a-zA-Z_]+|[^a-zA-Z_0-9]+/g, '');
            var fileName = 'thingworx/' + entityName + '.d.ts';
            TW.jqPlugins.twCodeEditor.monacoEditorLibs.push(monaco.languages.typescript.javascriptDefaults
                .addExtraLib(generateTypeScriptDefinitions(meThingModel, entityName), fileName));

            // avalible options: https://microsoft.github.io/monaco-editor/api/interfaces/monaco.editor.ieditoroptions.html
            var editor = monaco.editor.create(codeTextareaElem[0], {
                language: mode,
                readOnly: !thisPlugin.properties.editMode,
                value: generateServiceFirstLine(serviceModel.serviceDefinition, entityName) + "\n" + jqEl.find('.actual-code').val(),
                folding: true,
                fontSize: 12,
                fontFamily: "Fira Code,Monaco,monospace",
                fontLigatures: true,
                mouseWheelZoom: true,
                formatOnPaste: true,
                theme: "vs"
            });

            // TODO: Huge hack here. Because the folding controller resets the hidden areas,
            // we override the setHiddenAreas function to always hide the first three lines
            var proxiedSetHiddenAreas = editor.setHiddenAreas;
            editor.setHiddenAreas = function (ranges) {
                ranges.push(new monaco.Range(1, 1, 1, 2));
                ranges.push(new monaco.Range(2, 1, 1, 2))
                ranges.push(new monaco.Range(3, 1, 3, 2));
                return proxiedSetHiddenAreas.apply(this, arguments);
            };
            editor.setHiddenAreas([])

            // whenever the editor regains focus, we regenerate the first line (inputs defs) and me defs
            editor.onDidFocusEditor(function () {
                // get the service model again
                var serviceModel = jqEl.closest("tbody").find(".twServiceEditor").twServiceEditor("getAllProperties");
                var meThingModel = serviceModel.model;
                var entityName = meThingModel.entityType + '' + meThingModel.id.replace(/^[^a-zA-Z_]+|[^a-zA-Z_0-9]+/g, '');
                var op = {
                    range: firstLineRange,
                    text: generateServiceFirstLine(serviceModel.serviceDefinition, entityName),
                    forceMoveMarkers: true
                };
                // update the first list. Use apply edits for no undo stack
                thisPlugin.monacoEditor.executeEdits("modelUpdated", [op]);
                // remove the previous definitions
                removeEditorDefinitions();

                var fileName = 'thingworx/' + entityName + '.d.ts';
                TW.jqPlugins.twCodeEditor.monacoEditorLibs.push(monaco.languages.typescript.javascriptDefaults
                    .addExtraLib(generateTypeScriptDefinitions(meThingModel, entityName), fileName));
            });

            thisPlugin.monacoEditor = editor;
            editor.onDidChangeModelContent(function (e) {
                thisPlugin.properties.code = editor.getModel().getValueInRange(editableRange);
                thisPlugin.properties.change(thisPlugin.properties.code);
            });
            editor.layout();
        }
    });

    function generateServiceFirstLine(serviceMetadata, entityName) {
        var definition = "// The first line is not editable and declares the entities used in the service. The line is NOT saved\n";
        definition += "var me = new " + entityName + "(); "
        for (var key in serviceMetadata.parameterDefinitions) {
            if (!serviceMetadata.parameterDefinitions.hasOwnProperty(key)) continue;
            definition += "var " + key + ": " + serviceMetadata.parameterDefinitions[key].baseType + "; ";
        }
        return definition + '\n//------------------------------------------------------------------------';
    }

    function generateTypeScriptDefinitions(metadata, entityName) {
        // based on a module class declaration
        // https://www.typescriptlang.org/docs/handbook/declaration-files/templates/module-class-d-ts.html
        var namespaceDefinition = "declare namespace " + entityName + " {\n";
        var classDefinition = "declare class " + entityName + " {\n constructor(); \n";

        // generate info retated to services
        var serviceDefs = metadata.attributes.effectiveShape.serviceDefinitions;
        for (var key in serviceDefs) {
            if (!serviceDefs.hasOwnProperty(key)) continue;
            // first create an interface for service params
            var service = serviceDefs[key];
            var serviceParamDefinition = "";
            if (service.parameterDefinitions && Object.keys(service.parameterDefinitions).length > 0) {
                namespaceDefinition += "export interface " + service.name + "Params {\n";
                for (var parameterDef in service.parameterDefinitions) {
                    if (!service.parameterDefinitions.hasOwnProperty(parameterDef)) continue;
                    var inputDef = service.parameterDefinitions[parameterDef];

                    namespaceDefinition += "/** \n * " + inputDef.description +
                        (inputDef.aspects.dataShape ? ("  \n * Datashape: " + inputDef.aspects.dataShape) : "") + " \n */ \n " +
                        inputDef.name + ":" + inputDef.baseType + ";\n";
                    // generate a nice description of the service params
                    serviceParamDefinition += "*     " + inputDef.name + ": " + inputDef.baseType +
                        (inputDef.aspects.dataShape ? (" datashape with " + inputDef.aspects.dataShape) : "") + " - " + inputDef.description + "\n ";
                }
                namespaceDefinition += "}\n";
            }
            // now generate the definition
            classDefinition += "/** \n * Category: " + service.category + "\n * " + service.description +
                "\n * " + (serviceParamDefinition ? ("Params: \n " + serviceParamDefinition) : "\n") + " **/ \n " +
                service.name + "(" + (serviceParamDefinition ? ("params:" + entityName + "." + service.name + "Params") : "") +
                "): " + service.resultType.baseType + ";\n";
        }
        namespaceDefinition = namespaceDefinition + "}\n";

        // we handle property definitions here
        var propertyDefs = metadata.attributes.effectiveShape.propertyDefinitions;
        for (var key in propertyDefs) {
            if (!propertyDefs.hasOwnProperty(key)) continue;

            var property = propertyDefs[key];
            // generate an export for each property
            classDefinition += "/** \n * " + property.description + " \n */" + "\n" + property.name + ":" + property.baseType + ";\n";
        }
        classDefinition = classDefinition + "}\n";
        return "export as namespace " + entityName + ";\n" + namespaceDefinition + classDefinition;
    }

    function loadStandardTypescriptDefs() {
        // extra libraries
        monaco.languages.typescript.javascriptDefaults.addExtraLib([
            'declare class logger {',
            '    /**',
            '     * Log a debug warning',
            '     */',
            '    static debug(message:string)',
            '    /**',
            '     * Log a error warning',
            '     */',
            '    static error(message:string)',
            '    /**',
            '     * Log a warn warning',
            '     */',
            '    static warn(message:string)',
            '    /**',
            '     * Log a info warning',
            '     */',
            '    static info(message:string)',
            '}',
        ].join('\n'), 'thingworx/logger.d.ts');

        // extra libraries
        monaco.languages.typescript.javascriptDefaults.addExtraLib([
            'interface STRING extends String{}',
            'interface LOCATION {',
            '   latitude: number',
            '   longitude: number',
            '   elevation: number',
            '   units: string',
            '}',
            'interface NUMBER extends Number{}',
            'interface INTEGER extends Number{}',
            'interface LONG extends Number{}',
            'interface BOOLEAN extends boolean{}',
            'interface DASHBOADNAME extends String{}',
            'interface GROUPNAME extends String{}',
            'interface GUID extends String{}',
            'interface HTML extends String{}',
            'interface HYPERLINK extends String{}',
            'interface IMAGELINK extends String{}',
            'interface MASHUPNAME extends String{}',
            'interface MENUNAME extends String{}',
            'interface PASSWORD extends String{}',
            'interface TEXT extends String{}',
            'interface THINGCODE extends String{}',
            'interface THINGNAME extends String{}',
            'interface USERNAME extends String{}',
            'interface DATETIME extends Date{}',
        ].join('\n'), 'thingworx/baseTypes.d.ts');
    }

    function removeEditorDefinitions() {
        // remove the previous definitions
        for (var i = 0; i < TW.jqPlugins.twCodeEditor.monacoEditorLibs.length; i++) {
            TW.jqPlugins.twCodeEditor.monacoEditorLibs[i].dispose();
        }
        TW.jqPlugins.twCodeEditor.monacoEditorLibs = [];
    }
}