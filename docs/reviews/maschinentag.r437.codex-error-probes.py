"""R437: actual offline interpreter, no controller connection.
Reuse the repository's unmodified native runner; vary only the main program.
"""
from unittest.mock import patch
import pytest
import test_error_line_golden as golden

CASES = {
    f'{kind}_{pad}': (f'G21 G90\n{word}' + ' ' * pad + '\nM2\n', None)
    for pad in (0, 30, 80, 200)
    for kind, word in [('sub', 'o<bad_sub> call'), ('remap', 'M610')]
}

@pytest.fixture(scope='module')
def parsed():
    assert golden._HAS_GCODE, 'This evidence requires the actual interpreter'
    with patch.dict(golden.PROGRAMS, CASES, clear=True):
        golden.TestTheProvenErrorLine.setUpClass()
    try:
        yield golden.TestTheProvenErrorLine.got
    finally:
        golden.TestTheProvenErrorLine.tearDownClass()

@pytest.mark.parametrize('name', list(CASES))
def test_called_file_error_has_no_proven_main_line(parsed, name):
    error, line = parsed[f'{name}.ngc']
    assert error == 'No characters found in reading real value'
    assert line is None, (name, error, line)
