/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/
import { localize } from '../../nls.js';
export var PolicyCategory;
(function (PolicyCategory) {
    PolicyCategory["Extensions"] = "Extensions";
    PolicyCategory["IntegratedTerminal"] = "IntegratedTerminal";
    PolicyCategory["InteractiveSession"] = "InteractiveSession";
    PolicyCategory["Telemetry"] = "Telemetry";
    PolicyCategory["Update"] = "Update";
})(PolicyCategory || (PolicyCategory = {}));
export const PolicyCategoryData = {
    [PolicyCategory.Extensions]: {
        name: {
            key: 'extensionsConfigurationTitle', value: localize(55, "Extensions"),
        }
    },
    [PolicyCategory.IntegratedTerminal]: {
        name: {
            key: 'terminalIntegratedConfigurationTitle', value: localize(56, "Integrated Terminal"),
        }
    },
    [PolicyCategory.InteractiveSession]: {
        name: {
            key: 'interactiveSessionConfigurationTitle', value: localize(57, "Chat"),
        }
    },
    [PolicyCategory.Telemetry]: {
        name: {
            key: 'telemetryConfigurationTitle', value: localize(58, "Telemetry"),
        }
    },
    [PolicyCategory.Update]: {
        name: {
            key: 'updateConfigurationTitle', value: localize(59, "Update"),
        }
    }
};
//# sourceMappingURL=policy.js.map