import unittest
from pathlib import Path
import importlib.util
import sys

EXPORTER_PATH = Path(__file__).resolve().parents[1] / "pathlight_support.disabled" / "exporter.py"
SPEC = importlib.util.spec_from_file_location("pathlight_exporter", EXPORTER_PATH)
assert SPEC is not None
exporter = importlib.util.module_from_spec(SPEC)
sys.modules["pathlight_exporter"] = exporter
assert SPEC.loader is not None
SPEC.loader.exec_module(exporter)

build_trace_plan = exporter.build_trace_plan


class ExporterTests(unittest.TestCase):
    def test_maps_success_history_to_trace_and_spans(self):
        plan = build_trace_plan(
            {
                "prompt-1": {
                    "prompt": [
                        1,
                        "prompt-1",
                        {
                            "1": {"class_type": "CheckpointLoaderSimple", "inputs": {"ckpt_name": "model.safetensors"}},
                            "2": {"class_type": "SaveImage", "inputs": {"images": ["1", 0]}},
                        },
                    ],
                    "outputs": {"2": {"images": [{"filename": "out.png"}]}},
                    "status": {"status_str": "success", "completed": True, "messages": []},
                }
            }
        )

        self.assertEqual(plan["status"], "completed")
        self.assertEqual(plan["trace"]["metadata"]["promptId"], "prompt-1")
        self.assertEqual(len(plan["spans"]), 2)
        self.assertEqual(plan["spans"][1]["name"], "comfy.node.SaveImage")
        self.assertEqual(plan["spans"][1]["metadata"]["outputNode"], True)

    def test_marks_failed_node_from_execution_error(self):
        plan = build_trace_plan(
            {
                "prompt-2": {
                    "prompt": [
                        1,
                        "prompt-2",
                        {
                            "1": {"class_type": "LoadImage", "inputs": {"image": "missing.png"}},
                            "2": {"class_type": "KSampler", "inputs": {"seed": 7}},
                        },
                    ],
                    "status": {
                        "status_str": "error",
                        "completed": False,
                        "messages": [
                            [
                                "execution_error",
                                {
                                    "node_id": "1",
                                    "exception_message": "Image file not found",
                                },
                            ]
                        ],
                    },
                }
            }
        )

        self.assertEqual(plan["status"], "failed")
        self.assertEqual(plan["error"], "Image file not found")
        self.assertEqual(plan["spans"][0]["status"], "failed")
        self.assertEqual(plan["spans"][1]["status"], "completed")


if __name__ == "__main__":
    unittest.main()
