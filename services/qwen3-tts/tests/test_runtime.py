from __future__ import annotations

import tempfile
import unittest
from pathlib import Path

from kana_qwen3_tts.config import ServiceSettings
from kana_qwen3_tts.runtime import Qwen3TTSRuntime, _cpu_supports_bf16


class FakeTorch:
    """Stands in for the torch module without importing it.

    ``bf16_supported`` mirrors ``torch.cpu.is_bf16_supported``; set it to
    ``None`` to simulate a torch build that does not expose the API.
    """

    bf16_supported: bool | None = None
    capability = "AVX512"

    class cpu:
        @staticmethod
        def is_bf16_supported() -> bool:
            assert FakeTorch.bf16_supported is not None, (
                "set FakeTorch.bf16_supported to simulate the torch API"
            )
            return FakeTorch.bf16_supported

    float32 = "float32"
    float16 = "float16"
    bfloat16 = "bfloat16"


def fake_cpuinfo(flags: str) -> Path:
    handle = tempfile.NamedTemporaryFile(mode="w", suffix=".txt", delete=False)
    handle.write(f"flags : fpu avx {flags}\n")
    handle.close()
    return Path(handle.name)


def make_runtime(*, device: str, dtype: str) -> Qwen3TTSRuntime:
    return Qwen3TTSRuntime(
        ServiceSettings(
            model_id="test-model",
            model_revision="test-revision",
            device=device,
            dtype=dtype,
            attention="sdpa",
            cache_dir=None,
            data_dir=Path(tempfile.gettempdir()) / "kana-test-data",
            default_voice_id="",
            host="127.0.0.1",
            port=7860,
            max_characters=1200,
            max_new_tokens=128,
            allowed_origin_regex=r"^https?://127\.0\.0\.1(:\d+)?$",
        )
    )


class CpuBf16DetectionTest(unittest.TestCase):
    def tearDown(self) -> None:
        FakeTorch.bf16_supported = None

    def test_torch_api_result_is_trusted_when_present(self) -> None:
        FakeTorch.bf16_supported = False
        self.assertFalse(_cpu_supports_bf16(FakeTorch, fake_cpuinfo("avx512_bf16")))
        FakeTorch.bf16_supported = True
        self.assertTrue(_cpu_supports_bf16(FakeTorch, fake_cpuinfo("avx2")))

    def test_cpuinfo_fallback_detects_bf16_flags(self) -> None:
        # Simulate a torch build without torch.cpu.is_bf16_supported.
        torch_without_api = type(
            "TorchWithoutApi",
            (),
            {"float32": "float32", "float16": "float16", "bfloat16": "bfloat16"},
        )
        self.assertTrue(
            _cpu_supports_bf16(torch_without_api, fake_cpuinfo("avx512_bf16"))
        )
        self.assertTrue(
            _cpu_supports_bf16(torch_without_api, fake_cpuinfo("amx_bf16"))
        )
        self.assertFalse(
            _cpu_supports_bf16(torch_without_api, fake_cpuinfo("avx2 sse4_2"))
        )

    def test_missing_cpuinfo_is_treated_as_unsupported(self) -> None:
        torch_without_api = type(
            "TorchWithoutApi",
            (),
            {"float32": "float32", "float16": "float16", "bfloat16": "bfloat16"},
        )
        self.assertFalse(
            _cpu_supports_bf16(
                torch_without_api,
                Path(tempfile.gettempdir()) / "kana-missing-cpuinfo",
            )
        )


class ResolveDtypeTest(unittest.TestCase):
    def tearDown(self) -> None:
        FakeTorch.bf16_supported = None

    def test_cpu_auto_prefers_bfloat16_when_supported(self) -> None:
        FakeTorch.bf16_supported = True
        runtime = make_runtime(device="cpu", dtype="auto")
        self.assertEqual(runtime._resolve_dtype(FakeTorch), "bfloat16")

    def test_cpu_auto_falls_back_to_float32_without_bf16(self) -> None:
        FakeTorch.bf16_supported = False
        runtime = make_runtime(device="cpu", dtype="auto")
        self.assertEqual(runtime._resolve_dtype(FakeTorch), "float32")

    def test_cuda_auto_stays_float16(self) -> None:
        FakeTorch.bf16_supported = True
        runtime = make_runtime(device="cuda:0", dtype="auto")
        self.assertEqual(runtime._resolve_dtype(FakeTorch), "float16")

    def test_explicit_dtype_is_honored(self) -> None:
        FakeTorch.bf16_supported = True
        runtime = make_runtime(device="cpu", dtype="float32")
        self.assertEqual(runtime._resolve_dtype(FakeTorch), "float32")


if __name__ == "__main__":
    unittest.main()
